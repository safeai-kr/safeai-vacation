export type CancellationPolicyStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export function firstLeaveUsageDate(workDates: string[], startDate: string) {
  return workDates[0] || startDate;
}

export function resolveCancellationPolicy({
  status,
  isApplicant,
  isAdmin,
  firstUsageDate,
  endDate,
  today,
}: {
  status: CancellationPolicyStatus;
  isApplicant: boolean;
  isAdmin: boolean;
  firstUsageDate: string;
  endDate: string;
  today: string;
}) {
  if (!isApplicant && !isAdmin) return { canCancel: false, balanceWillRestore: false };
  if (status === 'PENDING') return { canCancel: true, balanceWillRestore: true };
  if (status !== 'APPROVED') return { canCancel: false, balanceWillRestore: false };
  if (endDate < today) return { canCancel: false, balanceWillRestore: false };

  const beforeUsage = firstUsageDate > today;
  return {
    canCancel: beforeUsage || isAdmin,
    balanceWillRestore: beforeUsage,
  };
}
