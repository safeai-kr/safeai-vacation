export type CancellationPolicyStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type CancellationPolicyDuration = 'FULL_DAY' | 'AM_HALF' | 'PM_HALF';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function kstDateTime(now: Date) {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS).toISOString();
  return {
    date: shifted.slice(0, 10),
    time: shifted.slice(11, 19),
  };
}

export function firstLeaveUsageDate(workDates: string[], startDate: string) {
  return workDates[0] || startDate;
}

export function resolveCancellationPolicy({
  status,
  isApplicant,
  isAdmin,
  firstUsageDate,
  endDate,
  duration,
  now = new Date(),
}: {
  status: CancellationPolicyStatus;
  isApplicant: boolean;
  isAdmin: boolean;
  firstUsageDate: string;
  endDate: string;
  duration: CancellationPolicyDuration;
  now?: Date;
}) {
  if (!isApplicant && !isAdmin) return { canCancel: false, balanceWillRestore: false };
  if (status === 'PENDING') return { canCancel: true, balanceWillRestore: true };
  if (status !== 'APPROVED') return { canCancel: false, balanceWillRestore: false };
  const current = kstDateTime(now);
  if (endDate < current.date) return { canCancel: false, balanceWillRestore: false };

  const beforeUsageDate = firstUsageDate > current.date;
  const cutoff = duration === 'PM_HALF' ? '14:00:00' : '10:00:00';
  const beforeSameDayCutoff = firstUsageDate === current.date && current.time < cutoff;
  const balanceWillRestore = beforeUsageDate || beforeSameDayCutoff;

  return {
    canCancel: balanceWillRestore || isAdmin,
    balanceWillRestore,
  };
}
