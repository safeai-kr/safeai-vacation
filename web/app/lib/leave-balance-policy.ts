const BALANCE_EPSILON = 0.0001;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const ANNUAL_ADVANCE_LIMIT_DAYS = 3;

export type AnnualLeaveUsageKind = 'REGULAR' | 'ADVANCE' | 'MIXED';

export interface AnnualLeaveAvailability {
  accruedRemainingDays: number;
  advanceUsedDays: number;
  advancePendingDays: number;
  advanceOccupiedDays: number;
  maxAdvanceDays: number;
  advanceAvailableDays: number;
  futureMonthlyGrantDays: number;
  requestableDays: number;
}

export interface AnnualLeaveUsageBreakdown {
  kind: AnnualLeaveUsageKind;
  regularDays: number;
  advanceDays: number;
}

function finiteValue(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function isValidIsoDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = parseIsoDate(value);
  return Number.isFinite(parsed.getTime()) && toIsoDate(parsed) === value;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addMonths(value: string, months: number) {
  const source = parseIsoDate(value);
  const targetMonth = source.getUTCMonth() + months;
  const year = source.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(source.getUTCDate(), daysInMonth(year, month));
  return toIsoDate(new Date(Date.UTC(year, month, day)));
}

export function normalizedAvailableDays(value: number) {
  return Math.max(Number.isFinite(value) ? value : 0, 0);
}

export function hasSufficientLeaveBalance(requestedDays: number, availableDays: number) {
  return requestedDays - normalizedAvailableDays(availableDays) <= BALANCE_EPSILON;
}

export function remainingUnderOneYearMonthlyGrantDays(hireDate: string, asOf: string) {
  if (!isValidIsoDate(hireDate) || !isValidIsoDate(asOf) || hireDate > asOf) return 0;
  const firstAnniversary = addMonths(hireDate, 12);
  if (asOf >= firstAnniversary) return 0;

  let remainingDays = 0;
  for (let month = 1; month <= 11; month += 1) {
    if (addMonths(hireDate, month) > asOf) remainingDays += 1;
  }
  return remainingDays;
}

export function calculateAnnualLeaveAvailability(input: {
  ledgerBalanceDays: number;
  pendingDays: number;
  futureMonthlyGrantDays: number;
}): AnnualLeaveAvailability {
  const ledgerBalanceDays = finiteValue(input.ledgerBalanceDays);
  const pendingDays = Math.max(finiteValue(input.pendingDays), 0);
  const futureMonthlyGrantDays = Math.max(finiteValue(input.futureMonthlyGrantDays), 0);
  const netBalanceDays = ledgerBalanceDays - pendingDays;
  const advanceUsedDays = Math.max(-ledgerBalanceDays, 0);
  const advanceOccupiedDays = Math.max(-netBalanceDays, 0);
  const advancePendingDays = Math.max(advanceOccupiedDays - advanceUsedDays, 0);
  const maxAdvanceDays = Math.min(ANNUAL_ADVANCE_LIMIT_DAYS, futureMonthlyGrantDays);
  const accruedRemainingDays = Math.max(netBalanceDays, 0);
  const advanceAvailableDays = Math.max(maxAdvanceDays - advanceOccupiedDays, 0);

  return {
    accruedRemainingDays,
    advanceUsedDays,
    advancePendingDays,
    advanceOccupiedDays,
    maxAdvanceDays,
    advanceAvailableDays,
    futureMonthlyGrantDays,
    requestableDays: accruedRemainingDays + advanceAvailableDays,
  };
}

export function calculateAnnualLeaveUsageBreakdown(input: {
  requestedDays: number;
  accruedAvailableDays: number;
}): AnnualLeaveUsageBreakdown {
  const requestedDays = Math.max(finiteValue(input.requestedDays), 0);
  const accruedAvailableDays = Math.max(finiteValue(input.accruedAvailableDays), 0);
  const regularDays = Math.min(requestedDays, accruedAvailableDays);
  const advanceDays = Math.max(requestedDays - regularDays, 0);
  const kind: AnnualLeaveUsageKind = advanceDays <= BALANCE_EPSILON
    ? 'REGULAR'
    : regularDays <= BALANCE_EPSILON
      ? 'ADVANCE'
      : 'MIXED';

  return { kind, regularDays, advanceDays };
}

export function hasSufficientAnnualLeaveBalance(
  requestedDays: number,
  availability: AnnualLeaveAvailability,
) {
  return requestedDays - availability.requestableDays <= BALANCE_EPSILON;
}
