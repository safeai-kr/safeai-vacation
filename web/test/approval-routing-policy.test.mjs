import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApprovalRoute } from '../app/lib/approval-routing-policy.ts';

const representative = {
  email: 'ceo@safeai.kr',
  name: '대표',
  teamId: '',
  position: 'REPRESENTATIVE',
  active: true,
  profileStatus: 'COMPLETE',
};
const teamLead = {
  email: 'lead@safeai.kr',
  name: '팀장',
  teamId: 'research',
  position: 'TEAM_LEAD',
  active: true,
  profileStatus: 'COMPLETE',
};
const employee = {
  email: 'member@safeai.kr',
  name: '직원',
  teamId: 'research',
  position: 'EMPLOYEE',
  active: true,
  profileStatus: 'COMPLETE',
};
const teams = [{ id: 'research', managerEmail: teamLead.email, active: true }];

test('직원 신청은 소속 팀의 팀장에게 전달한다', () => {
  const result = resolveApprovalRoute(employee, teams, [representative, teamLead, employee]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.kind, 'TEAM_MANAGER');
    assert.equal(result.approver.email, teamLead.email);
  }
});

test('팀장 신청은 소속 팀과 관계없이 대표에게 전달한다', () => {
  const otherTeam = [{ id: 'research', managerEmail: 'other.lead@safeai.kr', active: true }];
  const result = resolveApprovalRoute(teamLead, otherTeam, [representative, teamLead]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.kind, 'REPRESENTATIVE');
    assert.equal(result.approver.email, representative.email);
  }
});

test('대표 신청은 본인 자동 승인으로 처리한다', () => {
  const result = resolveApprovalRoute(representative, teams, [representative, teamLead]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.kind, 'AUTO_APPROVAL');
});

test('팀장이 아닌 직원을 팀 승인자로 사용하지 않는다', () => {
  const invalidTeams = [{ id: 'research', managerEmail: employee.email, active: true }];
  const anotherEmployee = { ...employee, email: 'another@safeai.kr' };
  const result = resolveApprovalRoute(anotherEmployee, invalidTeams, [representative, employee, anotherEmployee]);
  assert.deepEqual(result, { ok: false, error: 'TEAM_MANAGER_NOT_TEAM_LEAD' });
});

test('활성 대표가 없거나 여러 명이면 팀장 승인 경로를 만들지 않는다', () => {
  assert.deepEqual(
    resolveApprovalRoute(teamLead, teams, [teamLead]),
    { ok: false, error: 'REPRESENTATIVE_REQUIRED' },
  );
  assert.deepEqual(
    resolveApprovalRoute(teamLead, teams, [
      representative,
      { ...representative, email: 'second.ceo@safeai.kr' },
      teamLead,
    ]),
    { ok: false, error: 'MULTIPLE_REPRESENTATIVES' },
  );
});
