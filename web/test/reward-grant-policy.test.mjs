import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRewardReclaim,
  protectedRewardDays,
  validateRewardGrantAdjustment,
} from '../app/lib/reward-grant-policy.ts';

const allocations = [
  { days: 2, usageDate: '2026-08-10', status: 'USED' },
  { days: 1, usageDate: '2026-08-20', status: 'RESERVED' },
  { days: 0.5, usageDate: '2026-08-25', status: 'CANCELLED' },
];

test('포상 연차 보호량은 사용과 승인 대기만 포함한다', () => {
  assert.equal(protectedRewardDays(allocations), 3);
});

test('지급 일수를 사용·승인 대기 합계보다 작게 줄일 수 없다', () => {
  assert.match(validateRewardGrantAdjustment({
    grantedDays: 2.5,
    grantedOn: '2026-08-01',
    expiresOn: '2026-10-01',
    allocations,
  }), /3일보다/);
  assert.equal(validateRewardGrantAdjustment({
    grantedDays: 3,
    grantedOn: '2026-08-01',
    expiresOn: '2026-10-01',
    allocations,
  }), '');
});

test('변경된 유효기간 밖의 사용·승인 대기 내역이 있으면 수정할 수 없다', () => {
  assert.match(validateRewardGrantAdjustment({
    grantedDays: 5,
    grantedOn: '2026-08-15',
    expiresOn: '2026-10-15',
    allocations,
  }), /사용 기한/);
});

test('잔여 회수는 사용·승인 대기를 보존하고 미사용분만 줄인다', () => {
  assert.deepEqual(calculateRewardReclaim(5, allocations), {
    protectedDays: 3,
    reclaimedDays: 2,
    nextGrantedDays: 3,
    active: true,
  });
});

test('할당이 없는 지급 건은 전액 회수 후 비활성화한다', () => {
  assert.deepEqual(calculateRewardReclaim(1.5, []), {
    protectedDays: 0,
    reclaimedDays: 1.5,
    nextGrantedDays: 0,
    active: false,
  });
});
