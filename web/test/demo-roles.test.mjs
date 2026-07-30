import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ROLES, demoRoleForEmail, isDemoRole } from '../app/lib/demo-roles.ts';

test('데모 역할은 관리자·팀장·일반 직원 계정으로 연결된다', () => {
  assert.equal(DEMO_ROLES.admin.email, 'ceo@safeai.kr');
  assert.equal(DEMO_ROLES.teamLead.email, 'platform.lead@safeai.kr');
  assert.equal(DEMO_ROLES.employee.email, 'member@safeai.kr');
  assert.equal(demoRoleForEmail('PLATFORM.LEAD@SAFEAI.KR'), 'teamLead');
});

test('지원하지 않는 데모 역할은 허용하지 않는다', () => {
  assert.equal(isDemoRole('admin'), true);
  assert.equal(isDemoRole('teamLead'), true);
  assert.equal(isDemoRole('employee'), true);
  assert.equal(isDemoRole('representative'), false);
  assert.equal(isDemoRole(undefined), false);
});
