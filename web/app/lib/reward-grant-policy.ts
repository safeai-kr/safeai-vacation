export interface RewardAllocationPolicyInput {
  days: number;
  usageDate: string;
  status: 'RESERVED' | 'USED' | 'CANCELLED';
}

export function protectedRewardDays(allocations: RewardAllocationPolicyInput[]) {
  return allocations
    .filter(allocation => allocation.status === 'USED' || allocation.status === 'RESERVED')
    .reduce((sum, allocation) => sum + allocation.days, 0);
}

export function validateRewardGrantAdjustment(input: {
  grantedDays: number;
  grantedOn: string;
  expiresOn: string;
  allocations: RewardAllocationPolicyInput[];
}) {
  const protectedAllocations = input.allocations.filter(allocation => allocation.status === 'USED' || allocation.status === 'RESERVED');
  const protectedDays = protectedRewardDays(protectedAllocations);
  if (input.grantedDays + 0.0001 < protectedDays) {
    return `사용·승인 대기 중인 ${protectedDays}일보다 지급 일수를 적게 수정할 수 없습니다.`;
  }
  if (protectedAllocations.some(allocation => allocation.usageDate < input.grantedOn || allocation.usageDate > input.expiresOn)) {
    return '변경한 사용 기한에 포함되지 않는 사용 또는 승인 대기 내역이 있습니다.';
  }
  return '';
}

export function calculateRewardReclaim(grantedDays: number, allocations: RewardAllocationPolicyInput[]) {
  const protectedDays = protectedRewardDays(allocations);
  const reclaimedDays = Math.max(grantedDays - protectedDays, 0);
  return {
    protectedDays,
    reclaimedDays,
    nextGrantedDays: protectedDays,
    active: protectedDays > 0,
  };
}
