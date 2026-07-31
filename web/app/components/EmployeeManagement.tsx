'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmployeeBalance, EmployeeStatus, Permission, Position, Team } from '../lib/leave-store';
import Pagination, { getPageItems } from './Pagination';

async function send(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json() as {
    error?: string;
    annualSyncWarning?: boolean;
    transferredTeamCount?: number;
    correlationId?: string;
    diagnosticCode?: string;
    technicalMessage?: string;
  };
  if (!response.ok) {
    const diagnostic = [
      result.correlationId ? `오류 ID ${result.correlationId}` : '',
      result.diagnosticCode ? `코드 ${result.diagnosticCode}` : '',
      result.technicalMessage ?? '',
    ].filter(Boolean).join(' · ');
    throw new Error(`${result.error || '저장하지 못했습니다.'}${diagnostic ? ` — ${diagnostic}` : ''}`);
  }
  return result;
}

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function EmployeeManagement({ teams, employees }: { teams: Team[]; employees: EmployeeBalance[] }) {
  const router = useRouter();
  const [teamMessage, setTeamMessage] = useState('');
  const [employeeMessage, setEmployeeMessage] = useState('');
  const [employeeMessageIsError, setEmployeeMessageIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [managedTeamId, setManagedTeamId] = useState(teams[0]?.id ?? '');
  const [managedTeamName, setManagedTeamName] = useState(teams[0]?.name ?? '');
  const [managedTeamManager, setManagedTeamManager] = useState(teams[0]?.managerEmail ?? '');
  const [position, setPosition] = useState<Position>('EMPLOYEE');
  const [permission, setPermission] = useState<Permission>('GENERAL');
  const [employmentStatus, setEmploymentStatus] = useState<EmployeeStatus>('ACTIVE');
  const [replacementManagerEmail, setReplacementManagerEmail] = useState('');
  const [editingEmployee, setEditingEmployee] = useState<EmployeeBalance | null>(null);
  const [employeePage, setEmployeePage] = useState(1);
  const eligibleTeamLeads = employees.filter(employee => employee.active && employee.profileStatus === 'COMPLETE' && employee.position === 'TEAM_LEAD');
  const representative = employees.find(employee => employee.active && employee.profileStatus === 'COMPLETE' && employee.position === 'REPRESENTATIVE');

  function resetEmployeeEditor() {
    setEditingEmployee(null);
    setTeamId(teams[0]?.id ?? '');
    setPosition('EMPLOYEE');
    setPermission('GENERAL');
    setEmploymentStatus('ACTIVE');
    setReplacementManagerEmail('');
  }

  function editEmployee(employee: EmployeeBalance) {
    setEditingEmployee(employee);
    setTeamId(employee.teamId);
    setPosition(employee.position);
    setPermission(employee.permission);
    setEmploymentStatus(employee.employmentStatus);
    setReplacementManagerEmail('');
    setEmployeeMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setTeamMessage('');
    try {
      await send('/api/admin/teams', { id: managedTeamId || undefined, name: managedTeamName, managerEmail: managedTeamManager });
      setTeamMessage('팀을 저장했습니다.');
      router.refresh();
    } catch (error) {
      setTeamMessage(error instanceof Error ? error.message : '팀을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingEmployee?.active && employmentStatus !== 'ACTIVE' && !window.confirm(`${editingEmployee.name}님을 비활성화하시겠습니까? 연결된 승인 경로나 대기 신청이 있으면 저장되지 않습니다.`)) return;
    setSaving(true);
    setEmployeeMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await send('/api/admin/employees', {
        email: form.get('email'),
        name: form.get('name'),
        hireDate: form.get('hireDate'),
        teamId,
        position,
        permission,
        employmentStatus,
        slackUserId: form.get('slackUserId'),
        replacementManagerEmail,
        openingAnnualUsedDays: Number(form.get('openingAnnualUsedDays')),
      });
      setEmployeeMessageIsError(false);
      setEmployeeMessage(result.annualSyncWarning
        ? '직원 정보는 저장했지만 연차 자동 계산을 완료하지 못했습니다. 기록 관리의 실패 로그를 확인해 주세요.'
        : result.transferredTeamCount
          ? `직원 정보를 수정하고 담당 팀 ${result.transferredTeamCount}개를 새 팀장에게 이관했습니다.`
        : editingEmployee ? '직원 정보를 수정했습니다.' : '직원을 등록하고 연차를 자동 계산했습니다.');
      setEmployeePage(1);
      resetEmployeeEditor();
      router.refresh();
    } catch (error) {
      setEmployeeMessageIsError(true);
      setEmployeeMessage(error instanceof Error ? error.message : '직원 정보를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const selectedTeam = teams.find(team => team.id === teamId);
  const managedTeamsForEditingEmployee = editingEmployee
    ? teams.filter(team => team.managerEmail === editingEmployee.email)
    : [];
  const requiresTeamTransfer = managedTeamsForEditingEmployee.length > 0
    && (position !== 'TEAM_LEAD' || employmentStatus !== 'ACTIVE');
  const replacementCandidates = eligibleTeamLeads.filter(employee => employee.email !== editingEmployee?.email);
  const selectedTeamManagerEmail = requiresTeamTransfer && managedTeamsForEditingEmployee.some(team => team.id === selectedTeam?.id)
    ? replacementManagerEmail
    : selectedTeam?.managerEmail;
  const selectedTeamManager = employees.find(employee => employee.email === selectedTeamManagerEmail);
  const preview = employmentStatus !== 'ACTIVE'
    ? '비활성 직원 · 연차 신청 및 승인 처리 불가'
    : position === 'REPRESENTATIVE'
    ? '대표 본인 · 자동 승인'
    : position === 'TEAM_LEAD'
      ? representative
        ? `대표 → ${representative.name} (${representative.email})`
        : '활성 대표를 먼저 등록해 주세요.'
      : selectedTeamManagerEmail
        ? `${selectedTeam?.name ?? '소속 팀'} 팀장 → ${selectedTeamManager?.name ?? selectedTeamManagerEmail}`
        : '소속 팀의 팀장을 먼저 지정해 주세요.';
  const currentTeamManagerIsInvalid = Boolean(managedTeamManager && !eligibleTeamLeads.some(employee => employee.email === managedTeamManager));
  const paginatedEmployees = getPageItems(employees, employeePage);

  return (
    <div className="admin-layout">
      <div className="admin-forms">
        <section className="content-card management-form">
          <div className="card-header"><div><h2>팀 설정</h2><p>직원 신청을 받을 팀장을 지정합니다.</p></div></div>
          <form onSubmit={saveTeam}>
            <label className="field-label">대상 팀<select className="field-input" value={managedTeamId} onChange={event => {
              const id = event.target.value;
              const team = teams.find(item => item.id === id);
              setManagedTeamId(id);
              setManagedTeamName(team?.name ?? '');
              setManagedTeamManager(team?.managerEmail ?? '');
            }}><option value="">새 팀 추가</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label className="field-label">팀 이름<input className="field-input" value={managedTeamName} onChange={event => setManagedTeamName(event.target.value)} placeholder="예: 경영지원팀" required /></label>
            <label className="field-label">팀장<select className="field-input" value={managedTeamManager} onChange={event => setManagedTeamManager(event.target.value)} required>
              <option value="">활성 팀장 선택</option>
              {currentTeamManagerIsInvalid && <option value={managedTeamManager} disabled>현재 설정 · 미등록 또는 비활성 ({managedTeamManager})</option>}
              {eligibleTeamLeads.map(employee => <option key={employee.email} value={employee.email}>{employee.name} ({employee.email})</option>)}
            </select><span className="field-help">직책이 팀장인 활성 직원만 지정할 수 있습니다.</span></label>
            {teamMessage && <p className={teamMessage.includes('저장했습니다') ? 'form-success' : 'form-error'}>{teamMessage}</p>}
            <button className="primary-button" disabled={saving}>{managedTeamId ? '팀 정보 저장' : '새 팀 추가'}</button>
          </form>
        </section>

        <section className="content-card management-form">
          <div className="card-header">
            <div>
              <h2>{editingEmployee ? '직원 정보 수정' : '직원 등록'}</h2>
              <p>{editingEmployee ? `${editingEmployee.name}님의 등록 정보를 수정합니다.` : '입사일을 기준으로 현재까지의 연차를 자동 계산합니다.'}</p>
            </div>
            {editingEmployee && <button type="button" className="secondary-button" onClick={resetEmployeeEditor}>수정 취소</button>}
          </div>
          <form key={editingEmployee?.email ?? 'new-employee'} onSubmit={saveEmployee}>
            <div className="form-grid-2">
              <label className="field-label">이름<input className="field-input" name="name" defaultValue={editingEmployee?.name ?? ''} required /></label>
              <label className="field-label">이메일<input className="field-input" type="email" name="email" defaultValue={editingEmployee?.email ?? ''} placeholder="name@safeai.kr" readOnly={Boolean(editingEmployee)} required /><span className="field-help">{editingEmployee ? '이메일은 직원 식별값이므로 수정할 수 없습니다.' : '등록 후 이메일은 변경할 수 없습니다.'}</span></label>
              <label className="field-label">입사일<input className="field-input" type="date" name="hireDate" defaultValue={editingEmployee?.hireDate ?? ''} required /></label>
              <label className="field-label">기존 사용 연차<input className="field-input" type="number" name="openingAnnualUsedDays" min="0" step="0.5" defaultValue={editingEmployee?.openingAnnualUsedDays ?? 0} required /><span className="field-help">시스템 도입 전에 이미 사용한 일수</span></label>
              <label className="field-label">소속 팀<select className="field-input" value={teamId} onChange={event => setTeamId(event.target.value)}><option value="">소속 없음</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              <label className="field-label">직책<select className="field-input" value={position} onChange={event => setPosition(event.target.value as Position)}><option value="EMPLOYEE">직원</option><option value="TEAM_LEAD">팀장</option><option value="REPRESENTATIVE">대표</option></select></label>
              <label className="field-label">권한<select className="field-input" value={permission} onChange={event => setPermission(event.target.value as Permission)}><option value="GENERAL">일반</option><option value="ADMIN">관리자</option></select><span className="field-help">관리자는 직원과 팀 정보를 설정할 수 있습니다.</span></label>
              <label className="field-label">재직 상태<select className="field-input" value={employmentStatus} onChange={event => setEmploymentStatus(event.target.value as EmployeeStatus)}><option value="ACTIVE">재직</option><option value="ON_LEAVE">휴직</option><option value="RESIGNED">퇴사</option><option value="INACTIVE">기타 비활성</option></select><span className="field-help">비활성 직원은 신청·승인·포상 지급 대상에서 제외됩니다.</span></label>
              <label className="field-label">Slack 사용자 ID<input className="field-input" name="slackUserId" defaultValue={editingEmployee?.slackUserId ?? ''} placeholder="예: U012ABCDEF" /><span className="field-help">Slack 연동 전에는 비워둘 수 있습니다.</span></label>
            </div>
            {requiresTeamTransfer && (
              <label className="field-label">
                담당 팀 이관
                <select className="field-input" value={replacementManagerEmail} onChange={event => setReplacementManagerEmail(event.target.value)} required>
                  <option value="">새 팀장 선택</option>
                  {replacementCandidates.map(employee => <option key={employee.email} value={employee.email}>{employee.name} ({employee.email})</option>)}
                </select>
                <span className="field-help">{managedTeamsForEditingEmployee.map(team => team.name).join(', ')}의 팀장을 선택한 직원으로 함께 변경합니다.</span>
              </label>
            )}
            <div className="routing-preview"><b>예상 승인 경로</b><span>{preview}</span></div>
            {requiresTeamTransfer && replacementCandidates.length === 0 && <p className="form-error">담당 팀을 넘겨받을 다른 활성 팀장을 먼저 등록해 주세요.</p>}
            {employeeMessage && <p className={employeeMessageIsError ? 'form-error' : 'form-success'}>{employeeMessage}</p>}
            <button className="primary-button" disabled={saving || (requiresTeamTransfer && replacementCandidates.length === 0)}>{editingEmployee ? '직원 정보 수정' : '직원 등록'}</button>
          </form>
        </section>
      </div>

      <section className="content-card">
        <div className="card-header"><div><h2>등록 직원</h2><p>비활성 직원을 포함한 등록 정보와 실제 승인 경로입니다.</p></div><span>재직 {employees.filter(employee => employee.active).length}명 · 전체 {employees.length}명</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>직원</th><th>상태</th><th>직책</th><th>권한</th><th>팀</th><th>입사일</th><th>Slack ID</th><th>정기 연차</th><th>포상</th><th>승인자</th><th>관리</th></tr></thead>
            <tbody>{paginatedEmployees.items.map(employee => (
              <tr key={employee.email} className={!employee.active ? 'inactive-row' : undefined}>
                <td><strong>{employee.name}</strong><span>{employee.email}</span></td>
                <td>{employee.profileStatus !== 'COMPLETE'
                  ? <span className="status-badge status-pending">등록 미완료</span>
                  : <span className={`status-badge ${employee.active ? 'status-approved' : 'status-cancelled'}`}>{employee.employmentStatus === 'ACTIVE' ? '재직' : employee.employmentStatus === 'ON_LEAVE' ? '휴직' : employee.employmentStatus === 'RESIGNED' ? '퇴사' : '비활성'}</span>}</td>
                <td>{employee.position === 'REPRESENTATIVE' ? '대표' : employee.position === 'TEAM_LEAD' ? '팀장' : '직원'}</td>
                <td>{employee.permission === 'ADMIN' ? <span className="admin-badge">관리자</span> : '일반'}</td>
                <td>{employee.teamName || '-'}</td>
                <td>{employee.hireDate || '미등록'}</td>
                <td>{employee.slackUserId || '-'}</td>
                <td className="leave-balance-cell"><b className="balance-value">{formatDays(employee.annualRemainingDays)}일</b><span>부여 {formatDays(employee.annualGrantedDays)} · 사용 {formatDays(employee.annualUsedDays)}</span></td>
                <td>{formatDays(employee.rewardRemainingDays)}일</td>
                <td>{!employee.active ? '-' : employee.position === 'REPRESENTATIVE' ? '자동 승인' : employee.effectiveApproverName || employee.effectiveApproverEmail || '미지정'}</td>
                <td><button type="button" className="secondary-button" onClick={() => editEmployee(employee)}>수정</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <Pagination currentPage={paginatedEmployees.currentPage} totalItems={employees.length} onPageChange={setEmployeePage} ariaLabel="등록 직원 페이지" />
      </section>
    </div>
  );
}
