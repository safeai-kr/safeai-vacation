export type ApprovalPosition = 'EMPLOYEE' | 'TEAM_LEAD' | 'REPRESENTATIVE';

export type ApprovalRouteEmployee = {
  email: string;
  name: string;
  teamId: string;
  position: ApprovalPosition;
  active: boolean;
  profileStatus: 'COMPLETE' | 'INCOMPLETE';
};

export type ApprovalRouteTeam = {
  id: string;
  managerEmail: string;
  active: boolean;
};

export type ApprovalRouteError =
  | 'TEAM_REQUIRED'
  | 'TEAM_MANAGER_REQUIRED'
  | 'TEAM_MANAGER_INELIGIBLE'
  | 'TEAM_MANAGER_NOT_TEAM_LEAD'
  | 'SELF_APPROVAL'
  | 'REPRESENTATIVE_REQUIRED'
  | 'MULTIPLE_REPRESENTATIVES';

export type ApprovalRoute =
  | {
      ok: true;
      kind: 'AUTO_APPROVAL' | 'TEAM_MANAGER' | 'REPRESENTATIVE';
      approver: ApprovalRouteEmployee;
    }
  | {
      ok: false;
      error: ApprovalRouteError;
    };

function isEligible(employee: ApprovalRouteEmployee) {
  return employee.active && employee.profileStatus === 'COMPLETE';
}

export function resolveApprovalRoute(
  employee: ApprovalRouteEmployee,
  teams: ApprovalRouteTeam[],
  employees: ApprovalRouteEmployee[],
  allowSelfApproval = false,
): ApprovalRoute {
  if (employee.position === 'REPRESENTATIVE') {
    const representatives = employees.filter(item => isEligible(item) && item.position === 'REPRESENTATIVE');
    if (representatives.length > 1) return { ok: false, error: 'MULTIPLE_REPRESENTATIVES' };
    return { ok: true, kind: 'AUTO_APPROVAL', approver: employee };
  }

  if (employee.position === 'TEAM_LEAD') {
    const representatives = employees.filter(item => isEligible(item) && item.position === 'REPRESENTATIVE');
    if (representatives.length === 0) return { ok: false, error: 'REPRESENTATIVE_REQUIRED' };
    if (representatives.length > 1) return { ok: false, error: 'MULTIPLE_REPRESENTATIVES' };
    return { ok: true, kind: 'REPRESENTATIVE', approver: representatives[0] };
  }

  const team = teams.find(item => item.id === employee.teamId && item.active);
  if (!team) return { ok: false, error: 'TEAM_REQUIRED' };
  if (!team.managerEmail) return { ok: false, error: 'TEAM_MANAGER_REQUIRED' };
  const manager = employees.find(item => item.email === team.managerEmail);
  if (!manager || !isEligible(manager)) return { ok: false, error: 'TEAM_MANAGER_INELIGIBLE' };
  if (manager.email === employee.email && !allowSelfApproval) return { ok: false, error: 'SELF_APPROVAL' };
  if (manager.position !== 'TEAM_LEAD' && !(allowSelfApproval && manager.email === employee.email)) {
    return { ok: false, error: 'TEAM_MANAGER_NOT_TEAM_LEAD' };
  }
  return { ok: true, kind: 'TEAM_MANAGER', approver: manager };
}
