import type { LeaveDuration, LeaveSource, LeaveUsageKind } from './leave-store';

const USAGE_KIND_LABEL: Record<LeaveUsageKind, string> = {
  REGULAR: '정기 연차',
  ADVANCE: '선연차',
  MIXED: '정기+선연차',
  REWARD: '포상휴가',
};

const DURATION_LABEL: Record<LeaveDuration, string> = {
  FULL_DAY: '종일',
  AM_HALF: '오전 반차',
  PM_HALF: '오후 반차',
};

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function resolvedUsageKind(input: { source: LeaveSource; leaveUsageKind?: LeaveUsageKind }) {
  if (input.leaveUsageKind) return input.leaveUsageKind;
  return input.source === 'REWARD' ? 'REWARD' : 'REGULAR';
}

export function slackLeaveTypeLabel(input: {
  source: LeaveSource;
  duration: LeaveDuration;
  days: number;
  leaveUsageKind?: LeaveUsageKind;
}) {
  const kind = resolvedUsageKind(input);
  return `${USAGE_KIND_LABEL[kind]} · ${DURATION_LABEL[input.duration]} · ${formatDays(input.days)}일`;
}

export function slackLeaveBreakdownLabel(input: {
  source: LeaveSource;
  leaveUsageKind?: LeaveUsageKind;
  regularDays?: number;
  advanceDays?: number;
}) {
  if (resolvedUsageKind(input) !== 'MIXED') return '';
  return `정기 연차 ${formatDays(input.regularDays ?? 0)}일 + 선연차 ${formatDays(input.advanceDays ?? 0)}일`;
}
