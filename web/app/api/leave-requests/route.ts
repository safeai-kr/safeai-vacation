import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../lib/api-error';
import { createLeaveRequest, recordOperationFailure, type LeaveDuration, type LeaveSource } from '../../lib/leave-store';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../lib/auth';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = new Set<LeaveSource>(['ANNUAL', 'REWARD']);
const DURATIONS = new Set<LeaveDuration>(['FULL_DAY', 'AM_HALF', 'PM_HALF']);

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });

  const startDate = String(body.startDate ?? '');
  const endDate = String(body.endDate ?? '');
  const source = String(body.source ?? '') as LeaveSource;
  const duration = String(body.duration ?? '') as LeaveDuration;
  const reason = String(body.reason ?? '').trim();

  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || startDate > endDate) {
    return NextResponse.json({ error: '신청 기간을 확인해 주세요.' }, { status: 400 });
  }
  if (!SOURCES.has(source)) return NextResponse.json({ error: '차감할 휴가를 확인해 주세요.' }, { status: 400 });
  if (!DURATIONS.has(duration)) return NextResponse.json({ error: '사용 단위를 확인해 주세요.' }, { status: 400 });
  if (duration !== 'FULL_DAY' && startDate !== endDate) return NextResponse.json({ error: '반차는 하루만 선택할 수 있습니다.' }, { status: 400 });
  if (!reason || reason.length > 500) return NextResponse.json({ error: '상세 사유를 500자 이내로 입력해 주세요.' }, { status: 400 });

  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true, requestId: 'LV-DEMO' });

  try {
    const result = await createLeaveRequest(session, { startDate, endDate, source, duration, reason });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await recordOperationFailure({ actorEmail: session.email, operation: 'CREATE_LEAVE_REQUEST', targetType: 'LEAVE_REQUEST', error });
    const { message, expected } = apiErrorResponse(error, '연차 신청을 저장하지 못했습니다. 관리자에게 문의해 주세요.');
    const status = !expected
      ? 500
      : message.includes('부족')
      || message.includes('신청 가능한')
      || message.includes('이미 승인 또는 대기')
      ? 409
      : message.includes('활성 직원') || message.includes('승인자') || message.includes('소속 팀')
        ? 403
        : 400;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
