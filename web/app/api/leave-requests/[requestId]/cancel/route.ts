import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../../lib/api-error';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../../../lib/auth';
import { cancelLeaveRequest, recordOperationFailure } from '../../../../lib/leave-store';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  }
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { requestId } = await params;
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true, status: 'CANCELLED' });

  try {
    const result = await cancelLeaveRequest(requestId, session.email);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await recordOperationFailure({ actorEmail: session.email, operation: 'CANCEL_REQUEST', targetType: 'LEAVE_REQUEST', targetId: requestId, error });
    const { message, expected } = apiErrorResponse(error, '신청을 취소하지 못했습니다. 관리자에게 문의해 주세요.');
    const status = !expected
      ? 500
      : message.includes('찾을 수')
      ? 404
      : message.includes('권한') || message.includes('관리자만')
        ? 403
        : message.includes('취소할 수 없') || message.includes('일치하지 않아')
          ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
