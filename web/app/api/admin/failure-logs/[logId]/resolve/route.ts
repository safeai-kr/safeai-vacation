import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../../../lib/api-error';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../../../../lib/auth';
import { resolveOperationFailure } from '../../../../../lib/leave-store';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ logId: string }> },
) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { logId } = await params;
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true });
  try {
    return NextResponse.json({ ok: true, ...await resolveOperationFailure(session.email, logId) });
  } catch (error) {
    const { message, expected } = apiErrorResponse(error, '실패 로그를 확인 처리하지 못했습니다.');
    const status = !expected ? 500 : message.includes('권한') ? 403 : message.includes('찾을 수') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
