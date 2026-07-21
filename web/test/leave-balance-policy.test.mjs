import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasSufficientLeaveBalance,
  normalizedAvailableDays,
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
