import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAnnualLeaveAvailability,
  calculateAnnualLeaveUsageBreakdown,
  hasSufficientAnnualLeaveBalance,
  hasSufficientLeaveBalance,
  normalizedAvailableDays,
  remainingUnderOneYearMonthlyGrantDays,
} from '../app/lib/leave-balance-policy.ts';

test('정기·포상 휴가 모두 잔여 일수를 초과하면 신청을 막는다', () => {
  assert.equal(hasSufficientLeaveBalance(1, 1), true);
  assert.equal(hasSufficientLeaveBalance(1.5, 1), false);
  assert.equal(hasSufficientLeaveBalance(0.5, 0), false);
});

test('음수 또는 비정상 잔액은 신청 가능 0일로 처리한다', () => {
  assert.equal(normalizedAvailableDays(-1), 0);
  assert.equal(normalizedAvailableDays(Number.NaN), 0);
});

test('1년 미만 직원의 앞으로 발생할 월차 총량을 계산한다', () => {
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-09-02', '2026-09-02'), 11);
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-09-02', '2026-10-01'), 11);
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-09-02', '2026-10-02'), 10);
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-09-02', '2027-08-02'), 0);
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-09-02', '2027-09-02'), 0);
});

test('말일 입사자의 월차 발생일도 기존 월차 계산과 동일하게 보정한다', () => {
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-01-31', '2026-02-27'), 11);
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-01-31', '2026-02-28'), 10);
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-01-31', '2026-03-31'), 9);
});

test('잘못된 입사일에는 선사용 한도를 부여하지 않는다', () => {
  assert.equal(remainingUnderOneYearMonthlyGrantDays('', '2026-09-02'), 0);
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-02-31', '2026-09-02'), 0);
  assert.equal(remainingUnderOneYearMonthlyGrantDays('2026-09-03', '2026-09-02'), 0);
});

test('발생 잔액과 최대 3일의 선연차 범위에서 신청할 수 있다', () => {
  const availability = calculateAnnualLeaveAvailability({
    ledgerBalanceDays: 2,
    pendingDays: 0.5,
    futureMonthlyGrantDays: 9,
  });

  assert.deepEqual(availability, {
    accruedRemainingDays: 1.5,
    advanceUsedDays: 0,
    advancePendingDays: 0,
    advanceOccupiedDays: 0,
    maxAdvanceDays: 3,
    advanceAvailableDays: 3,
    futureMonthlyGrantDays: 9,
    requestableDays: 4.5,
  });
  assert.equal(hasSufficientAnnualLeaveBalance(4.5, availability), true);
  assert.equal(hasSufficientAnnualLeaveBalance(5, availability), false);
});

test('승인된 선연차와 승인 대기 선연차를 합산해 3일 한도를 보호한다', () => {
  const availability = calculateAnnualLeaveAvailability({
    ledgerBalanceDays: -2,
    pendingDays: 0.5,
    futureMonthlyGrantDays: 9,
  });

  assert.deepEqual(availability, {
    accruedRemainingDays: 0,
    advanceUsedDays: 2,
    advancePendingDays: 0.5,
    advanceOccupiedDays: 2.5,
    maxAdvanceDays: 3,
    advanceAvailableDays: 0.5,
    futureMonthlyGrantDays: 9,
    requestableDays: 0.5,
  });
});

test('선연차 3일 사용 후 월차 1일이 발생하면 다시 1일을 선사용할 수 있다', () => {
  const beforeGrant = calculateAnnualLeaveAvailability({
    ledgerBalanceDays: -3,
    pendingDays: 0,
    futureMonthlyGrantDays: 11,
  });
  const afterGrant = calculateAnnualLeaveAvailability({
    ledgerBalanceDays: -2,
    pendingDays: 0,
    futureMonthlyGrantDays: 10,
  });

  assert.equal(beforeGrant.advanceUsedDays, 3);
  assert.equal(beforeGrant.advanceAvailableDays, 0);
  assert.equal(hasSufficientAnnualLeaveBalance(0.5, beforeGrant), false);
  assert.equal(afterGrant.advanceUsedDays, 2);
  assert.equal(afterGrant.advanceAvailableDays, 1);
});

test('남은 미래 월차가 3일보다 적으면 해당 총량까지만 선사용할 수 있다', () => {
  const availability = calculateAnnualLeaveAvailability({
    ledgerBalanceDays: 0,
    pendingDays: 0,
    futureMonthlyGrantDays: 1,
  });

  assert.equal(availability.maxAdvanceDays, 1);
  assert.equal(availability.advanceAvailableDays, 1);
  assert.equal(availability.requestableDays, 1);
});

test('3일 순환 한도를 반복 사용해도 1년 미만 월차 총량은 11일을 넘지 않는다', () => {
  let ledgerBalanceDays = 0;
  let futureMonthlyGrantDays = 11;
  let usedDays = 0;

  while (futureMonthlyGrantDays > 0) {
    const availability = calculateAnnualLeaveAvailability({ ledgerBalanceDays, pendingDays: 0, futureMonthlyGrantDays });
    ledgerBalanceDays -= availability.advanceAvailableDays;
    usedDays += availability.advanceAvailableDays;
    ledgerBalanceDays += 1;
    futureMonthlyGrantDays -= 1;
  }

  const finalAvailability = calculateAnnualLeaveAvailability({ ledgerBalanceDays, pendingDays: 0, futureMonthlyGrantDays });
  assert.equal(usedDays, 11);
  assert.equal(ledgerBalanceDays, 0);
  assert.equal(finalAvailability.requestableDays, 0);
});

test('신청 일수를 정기 연차와 선연차로 분해한다', () => {
  assert.deepEqual(calculateAnnualLeaveUsageBreakdown({ requestedDays: 1, accruedAvailableDays: 2 }), {
    kind: 'REGULAR', regularDays: 1, advanceDays: 0,
  });
  assert.deepEqual(calculateAnnualLeaveUsageBreakdown({ requestedDays: 1, accruedAvailableDays: 0 }), {
    kind: 'ADVANCE', regularDays: 0, advanceDays: 1,
  });
  assert.deepEqual(calculateAnnualLeaveUsageBreakdown({ requestedDays: 1.5, accruedAvailableDays: 1 }), {
    kind: 'MIXED', regularDays: 1, advanceDays: 0.5,
  });
});

test('입사 1년이 지나면 기존 발생 잔액까지만 신청할 수 있다', () => {
  const futureMonthlyGrantDays = remainingUnderOneYearMonthlyGrantDays('2025-09-02', '2026-09-02');
  const availability = calculateAnnualLeaveAvailability({
    ledgerBalanceDays: 1,
    pendingDays: 0.5,
    futureMonthlyGrantDays,
  });

  assert.equal(futureMonthlyGrantDays, 0);
  assert.equal(availability.requestableDays, 0.5);
});
