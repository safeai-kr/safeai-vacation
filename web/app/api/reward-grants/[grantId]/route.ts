import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../lib/api-error';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../../lib/auth';
import { recordOperationFailure, updateRewardGrant } from '../../../lib/leave-store';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ grantId: string }> },
) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { grantId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const grantedDays = Number(body?.grantedDays);
  const grantedOn = String(body?.grantedOn ?? '');
  const memo = String(body?.memo ?? '').trim();
  const expectedMutationVersion = Number(body?.expectedMutationVersion);
  if (!body || !Number.isFinite(grantedDays) || grantedDays <= 0 || grantedDays > 30 || (grantedDays * 2) % 1 !== 0) {
    return NextResponse.json({ error: '포상 연차는 0.5일 단위로 입력해 주세요.' }, { status: 400 });
  }
  if (!DATE_PATTERN.test(grantedOn)) return NextResponse.json({ error: '지급일을 확인해 주세요.' }, { status: 400 });
  if (!memo || memo.length > 200) return NextResponse.json({ error: '포상 내용을 200자 이내로 입력해 주세요.' }, { status: 400 });
  if (!Number.isInteger(expectedMutationVersion) || expectedMutationVersion < 0) return NextResponse.json({ error: '수정 기준 버전을 확인해 주세요.' }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true });

  try {
    return NextResponse.json({ ok: true, ...await updateRewardGrant(session.email, grantId, { grantedDays, grantedOn, memo, expectedMutationVersion }) });
  } catch (error) {
    await recordOperationFailure({ actorEmail: session.email, operation: 'UPDATE_REWARD_LEAVE', targetType: 'REWARD_GRANT', targetId: grantId, error });
    const { message, expected } = apiErrorResponse(error, '포상 연차를 수정하지 못했습니다. 관리자 실패 로그를 확인해 주세요.');
    const status = !expected
      ? 500
      : message.includes('관리자 또는') || message.includes('관리자만') || message.includes('팀장')
      ? 403
      : message.includes('찾을 수')
        ? 404
        : message.includes('적게 수정') || message.includes('포함되지') || message.includes('전액 회수') || message.includes('먼저 변경') || message.includes('비활성 직원')
          ? 409
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
