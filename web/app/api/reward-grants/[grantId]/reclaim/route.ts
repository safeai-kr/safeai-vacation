import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../../lib/api-error';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../../../lib/auth';
import { reclaimRewardGrant, recordOperationFailure } from '../../../../lib/leave-store';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ grantId: string }> },
) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { grantId } = await params;
  const body = await request.json().catch(() => null) as { expectedMutationVersion?: unknown } | null;
  const expectedMutationVersion = Number(body?.expectedMutationVersion);
  if (!Number.isInteger(expectedMutationVersion) || expectedMutationVersion < 0) {
    return NextResponse.json({ error: '회수 기준 버전을 확인해 주세요.' }, { status: 400 });
  }
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true });

  try {
    return NextResponse.json({ ok: true, ...await reclaimRewardGrant(session.email, grantId, expectedMutationVersion) });
  } catch (error) {
    await recordOperationFailure({ actorEmail: session.email, operation: 'RECLAIM_REWARD_LEAVE', targetType: 'REWARD_GRANT', targetId: grantId, error });
    const { message, expected } = apiErrorResponse(error, '포상 연차를 회수하지 못했습니다. 관리자 실패 로그를 확인해 주세요.');
    const status = !expected
      ? 500
      : message.includes('관리자') || message.includes('팀장')
      ? 403
      : message.includes('찾을 수')
        ? 404
        : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
