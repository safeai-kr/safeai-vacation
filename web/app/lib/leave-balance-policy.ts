const BALANCE_EPSILON = 0.0001;

export function normalizedAvailableDays(value: number) {
  return Math.max(Number.isFinite(value) ? value : 0, 0);
}

export function hasSufficientLeaveBalance(requestedDays: number, availableDays: number) {
  return requestedDays - normalizedAvailableDays(availableDays) <= BALANCE_EPSILON;
}
