import assert from 'node:assert/strict';
import test from 'node:test';
import {
  slackLeaveBreakdownLabel,
  slackLeaveTypeLabel,
} from '../app/lib/leave-message-policy.ts';

test('승인자 DM에서 정기 연차와 포상휴가를 구분한다', () => {
  assert.equal(slackLeaveTypeLabel({
    source: 'ANNUAL',
    duration: 'FULL_DAY',
    days: 1,
    leaveUsageKind: 'REGULAR',
  }), '정기 연차 · 종일 · 1일');
  assert.equal(slackLeaveTypeLabel({
    source: 'REWARD',
    duration: 'AM_HALF',
    days: 0.5,
    leaveUsageKind: 'REWARD',
  }), '포상휴가 · 오전 반차 · 0.5일');
});

test('승인자 DM에서 선연차와 반차를 함께 표시한다', () => {
  assert.equal(slackLeaveTypeLabel({
    source: 'ANNUAL',
    duration: 'PM_HALF',
    days: 0.5,
    leaveUsageKind: 'ADVANCE',
  }), '선연차 · 오후 반차 · 0.5일');
});

test('혼합 사용은 종류와 정기·선연차 구성을 상세 표시한다', () => {
  const request = {
    source: 'ANNUAL',
    duration: 'FULL_DAY',
    days: 2,
    leaveUsageKind: 'MIXED',
    regularDays: 1,
    advanceDays: 1,
  };

  assert.equal(slackLeaveTypeLabel(request), '정기+선연차 · 종일 · 2일');
  assert.equal(slackLeaveBreakdownLabel(request), '정기 연차 1일 + 선연차 1일');
});

test('기존 신청 데이터는 휴가 원천을 기준으로 안전하게 표시한다', () => {
  assert.equal(slackLeaveTypeLabel({
    source: 'ANNUAL',
    duration: 'FULL_DAY',
    days: 1,
  }), '정기 연차 · 종일 · 1일');
  assert.equal(slackLeaveTypeLabel({
    source: 'REWARD',
    duration: 'FULL_DAY',
    days: 1,
  }), '포상휴가 · 종일 · 1일');
});
