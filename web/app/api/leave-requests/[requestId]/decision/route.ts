import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../../lib/api-error';
import { decideLeaveRequest, recordOperationFailure } from '../../../../lib/leave-store';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../../../lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: '처리 방법을 확인해 주세요.' }, { status: 400 });
  }

  const { requestId } = await params;
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true });

  try {
    const result = await decideLeaveRequest(requestId, session.email, action);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await recordOperationFailure({ actorEmail: session.email, operation: action === 'approve' ? 'APPROVE_REQUEST' : 'REJECT_REQUEST', targetType: 'LEAVE_REQUEST', targetId: requestId, error });
    const { message, expected } = apiErrorResponse(error, '신청을 처리하지 못했습니다. 관리자에게 문의해 주세요.');
    const status = !expected
      ? 500
      : message.includes('담당 승인자') || message.includes('활성 사내 승인자') || message.includes('본인의 신청')
      ? 403
      : message.includes('이미 처리') || message.includes('부족') || message.includes('일치하지')
        ? 409
        : message.includes('찾을 수')
          ? 404
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
