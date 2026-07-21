import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../lib/api-error';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../lib/auth';
import { grantRewardLeave, recordOperationFailure } from '../../lib/leave-store';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });

  const employeeEmail = String(body.employeeEmail ?? '').trim().toLowerCase();
  const grantedDays = Number(body.grantedDays);
  const grantedOn = String(body.grantedOn ?? '');
  const memo = String(body.memo ?? '').trim();

  if (!employeeEmail.includes('@')) return NextResponse.json({ error: '지급 대상 직원을 확인해 주세요.' }, { status: 400 });
  if (!Number.isFinite(grantedDays) || grantedDays <= 0 || grantedDays > 30 || (grantedDays * 2) % 1 !== 0) {
    return NextResponse.json({ error: '포상 연차는 0.5일 단위로 입력해 주세요.' }, { status: 400 });
  }
  if (!DATE_PATTERN.test(grantedOn)) return NextResponse.json({ error: '지급일을 확인해 주세요.' }, { status: 400 });
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const datePart = (type: string) => dateParts.find(part => part.type === type)?.value ?? '';
  const today = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
  if (grantedOn > today) return NextResponse.json({ error: '포상 연차 지급일은 오늘보다 늦을 수 없습니다.' }, { status: 400 });
  if (!memo || memo.length > 200) return NextResponse.json({ error: '포상 내용을 200자 이내로 입력해 주세요.' }, { status: 400 });

  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true, expiresOn: grantedOn });

  try {
    const result = await grantRewardLeave(session.email, { employeeEmail, grantedDays, grantedOn, memo });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await recordOperationFailure({ actorEmail: session.email, operation: 'GRANT_REWARD_LEAVE', targetType: 'EMPLOYEE', targetId: employeeEmail, error });
    const { message, expected } = apiErrorResponse(error, '포상 연차를 지급하지 못했습니다. 관리자 실패 로그를 확인해 주세요.');
    const status = !expected ? 500 : message.includes('관리자 또는') ? 403 : message.includes('찾을 수 없습니다') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
