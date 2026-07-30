export type DemoRole = 'admin' | 'teamLead' | 'employee';

export const DEMO_ROLES: Record<DemoRole, {
  label: string;
  email: string;
  name: string;
}> = {
  admin: {
    label: '관리자',
    email: 'ceo@safeai.kr',
    name: '김대표',
  },
  teamLead: {
    label: '팀장',
    email: 'platform.lead@safeai.kr',
    name: '박팀장',
  },
  employee: {
    label: '일반 직원',
    email: 'member@safeai.kr',
    name: '정직원',
  },
};

export function isDemoRole(value: unknown): value is DemoRole {
  return value === 'admin' || value === 'teamLead' || value === 'employee';
}

export function demoRoleForEmail(email: string): DemoRole {
  const normalizedEmail = email.trim().toLowerCase();
  return (Object.keys(DEMO_ROLES) as DemoRole[]).find(
    role => DEMO_ROLES[role].email === normalizedEmail,
  ) ?? 'admin';
}
