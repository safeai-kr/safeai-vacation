import type { LeaveDuration } from './leave-store';

export interface AdminLeaveRegistrationInput {
  employeeEmail: string;
  duration: LeaveDuration;
  startDate: string;
  endDate: string;
  reason: string;
  registrationKey: string;
}

export type ValidatedAdminLeaveRegistration = AdminLeaveRegistrationInput & {
  workDates: string[];
  days: number;
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateAdminLeaveRegistration(body: Record<string, unknown>):
  | { ok: true; input: ValidatedAdminLeaveRegistration }
  | { ok: false; error: string } {
  const employeeEmail = String(body.employeeEmail ?? '').trim().toLowerCase();
  const duration = String(body.duration ?? '') as LeaveDuration;
  const startDate = String(body.startDate ?? '');
  const endDate = String(body.endDate ?? '');
  const reason = String(body.reason ?? '').trim();
  const registrationKey = String(body.registrationKey ?? '');
  if (!/^[^\s@]+@[^\s@]+$/.test(employeeEmail)) return { ok: false, error: '대상 직원을 선택해 주세요.' };
  if (!['FULL_DAY', 'AM_HALF', 'PM_HALF'].includes(duration)) return { ok: false, error: '사용 단위를 확인해 주세요.' };
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    return { ok: false, error: '사용 기간을 확인해 주세요.' };
  }
  if (duration !== 'FULL_DAY' && startDate !== endDate) return { ok: false, error: '반차는 하루만 선택할 수 있습니다.' };
  if (!reason || reason.length > 500) return { ok: false, error: '관리자 등록 사유를 500자 이내로 입력해 주세요.' };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registrationKey)) {
    return { ok: false, error: '등록 정보를 확인할 수 없습니다. 화면을 새로고침해 주세요.' };
  }
  const first = Date.parse(`${startDate}T00:00:00.000Z`);
  const last = Date.parse(`${endDate}T00:00:00.000Z`);
  if (last - first > 365 * 86_400_000) return { ok: false, error: '한 번에 등록할 수 있는 기간은 최대 1년입니다.' };
  const workDates: string[] = [];
  for (let value = first; value <= last; value += 86_400_000) {
    const date = new Date(value);
    if (![0, 6].includes(date.getUTCDay())) workDates.push(date.toISOString().slice(0, 10));
  }
  if (!workDates.length) return { ok: false, error: '주말에는 휴가를 등록할 수 없습니다.' };
  return {
    ok: true,
    input: { employeeEmail, duration, startDate, endDate, reason, registrationKey, workDates, days: duration === 'FULL_DAY' ? workDates.length : 0.5 },
  };
}
