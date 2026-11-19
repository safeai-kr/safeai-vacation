import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../lib/api-error';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../../lib/auth';
import { validateAdminLeaveRegistration } from '../../../lib/admin-leave-registration-policy';
import { registerAdminLeave, registerDemoAdminLeave, recordOperationFailure } from '../../../lib/leave-store';

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '등록 형식을 확인해 주세요.' }, { status: 400 });
  const validation = validateAdminLeaveRegistration(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  try {
    const demo = isDemoMode();
    const result = demo
      ? registerDemoAdminLeave(session.email, validation.input)
      : await registerAdminLeave(session.email, validation.input);
    return NextResponse.json({ ok: true, demo, ...result });
  } catch (error) {
    const { message, expected } = apiErrorResponse(error, '연차 사용을 등록하지 못했습니다. 기록 관리에서 오류를 확인해 주세요.');
    if (!isDemoMode()) await recordOperationFailure({
      actorEmail: session.email,
      operation: 'ADMIN_REGISTER_LEAVE',
      targetType: 'EMPLOYEE',
      targetId: validation.input.employeeEmail,
      error,
    });
    return NextResponse.json({ error: message }, { status: !expected ? 500 : message.includes('관리자만') || message.includes('관리 권한') ? 403 : message.includes('이미') || message.includes('동일한 등록') ? 409 : 400 });
  }
}
