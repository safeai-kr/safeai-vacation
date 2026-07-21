import assert from 'node:assert/strict';
import test from 'node:test';
import { firstLeaveUsageDate, resolveCancellationPolicy } from '../app/lib/leave-cancellation-policy.ts';

const base = {
  isApplicant: true,
  isAdmin: false,
  firstUsageDate: '2026-07-20',
  today: '2026-07-17',
};

test('신청자는 승인 대기 신청을 즉시 취소하고 예약 잔액을 되돌릴 수 있다', () => {
  assert.deepEqual(resolveCancellationPolicy({ ...base, status: 'PENDING' }), {
    canCancel: true,
    balanceWillRestore: true,
  });
});

test('신청자는 시작 전 승인 신청을 취소하고 잔액을 복구할 수 있다', () => {
  assert.deepEqual(resolveCancellationPolicy({ ...base, status: 'APPROVED' }), {
    canCancel: true,
    balanceWillRestore: true,
  });
});

test('일반 신청자는 시작일 당일 이후 승인 신청을 취소할 수 없다', () => {
  assert.deepEqual(resolveCancellationPolicy({
    ...base,
    status: 'APPROVED',
    firstUsageDate: '2026-07-17',
  }), {
    canCancel: false,
    balanceWillRestore: false,
  });
});

test('관리자는 시작일 당일 이후 승인 신청을 기록 취소하되 잔액을 자동 복구하지 않는다', () => {
  assert.deepEqual(resolveCancellationPolicy({
    ...base,
    status: 'APPROVED',
    isApplicant: false,
    isAdmin: true,
    firstUsageDate: '2026-07-17',
  }), {
    canCancel: true,
    balanceWillRestore: false,
  });
});

test('신청자나 관리자가 아니면 대기 신청도 취소할 수 없다', () => {
  assert.deepEqual(resolveCancellationPolicy({
    ...base,
    status: 'PENDING',
    isApplicant: false,
  }), {
    canCancel: false,
    balanceWillRestore: false,
  });
});

test('반려 또는 취소된 신청은 다시 취소할 수 없다', () => {
  assert.equal(resolveCancellationPolicy({ ...base, status: 'REJECTED' }).canCancel, false);
  assert.equal(resolveCancellationPolicy({ ...base, status: 'CANCELLED' }).canCancel, false);
});

test('주말부터 시작한 신청은 첫 실제 근무일을 차감 기준일로 사용한다', () => {
  assert.equal(firstLeaveUsageDate(['2027-01-04'], '2027-01-02'), '2027-01-04');
  assert.equal(firstLeaveUsageDate([], '2027-01-02'), '2027-01-02');
});
