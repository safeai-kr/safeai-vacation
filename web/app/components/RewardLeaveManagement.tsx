'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmployeeBalance, RewardGrantView } from '../lib/leave-store';
import Pagination, { getPageItems } from './Pagination';

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split('-');
  return `${year}.${month}.${day}`;
}

export default function RewardLeaveManagement({
  employees,
  grants,
}: {
  employees: EmployeeBalance[];
  grants: RewardGrantView[];
}) {
  const router = useRouter();
  const [employeeEmail, setEmployeeEmail] = useState(employees[0]?.email ?? '');
  const [grantedDays, setGrantedDays] = useState('1');
  const [grantedOn, setGrantedOn] = useState(today());
  const [memo, setMemo] = useState('');
  const [editingGrant, setEditingGrant] = useState<RewardGrantView | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [grantPage, setGrantPage] = useState(1);
  const expiresOn = useMemo(() => grantedOn ? addDays(grantedOn, 61) : '', [grantedOn]);
  const currentDate = today();
  const selectedEmployeeMissing = Boolean(employeeEmail && !employees.some(employee => employee.email === employeeEmail));

  function resetEditor() {
    setEditingGrant(null);
    setEmployeeEmail(employees[0]?.email ?? '');
    setGrantedDays('1');
    setGrantedOn(today());
    setMemo('');
  }

  function beginEdit(grant: RewardGrantView) {
    setEditingGrant(grant);
    setEmployeeEmail(grant.employeeEmail);
    setGrantedDays(String(grant.grantedDays));
    setGrantedOn(grant.grantedOn);
    setMemo(grant.memo);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(editingGrant ? `/api/reward-grants/${editingGrant.id}` : '/api/reward-grants', {
        method: editingGrant ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingGrant ? {} : { employeeEmail }),
          grantedDays: Number(grantedDays),
          grantedOn,
          memo,
          ...(editingGrant ? { expectedMutationVersion: editingGrant.mutationVersion } : {}),
        }),
      });
      const result = await response.json() as { error?: string; demo?: boolean };
      if (!response.ok) throw new Error(result.error || `포상 연차를 ${editingGrant ? '수정' : '지급'}하지 못했습니다.`);
      setIsError(false);
      setMessage(result.demo
        ? '데모 처리를 확인했습니다. 실제 Firebase에는 저장되지 않았습니다.'
        : editingGrant
          ? '포상 연차 지급 정보를 수정했습니다.'
          : '포상 연차를 지급했습니다.');
      setGrantPage(1);
      resetEditor();
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : '포상 연차를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function reclaim(grant: RewardGrantView) {
    const detail = `미사용 잔여 ${formatDays(grant.remainingDays)}일을 회수합니다. 사용 ${formatDays(grant.usedDays)}일과 승인 대기 ${formatDays(grant.reservedDays)}일은 유지됩니다.`;
    if (!window.confirm(`${grant.employeeName}님의 포상 연차를 회수하시겠습니까?\n\n${detail}`)) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`/api/reward-grants/${grant.id}/reclaim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedMutationVersion: grant.mutationVersion }),
      });
      const result = await response.json() as { error?: string; demo?: boolean; reclaimedDays?: number };
      if (!response.ok) throw new Error(result.error || '포상 연차를 회수하지 못했습니다.');
      setIsError(false);
      setMessage(result.demo
        ? '데모 회수를 확인했습니다. 실제 Firebase에는 저장되지 않았습니다.'
        : `미사용 포상 연차 ${formatDays(result.reclaimedDays ?? 0)}일을 회수했습니다.`);
      if (editingGrant?.id === grant.id) resetEditor();
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : '포상 연차를 회수하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const paginatedGrants = getPageItems(grants, grantPage);

  return (
    <div className="reward-layout">
      <section className="content-card form-card">
        <div className="card-header">
          <div>
            <h2>{editingGrant ? '포상 연차 수정' : '포상 연차 지급'}</h2>
            <p>{editingGrant ? '사용·승인 대기 일수는 줄이거나 유효기간 밖으로 이동할 수 없습니다.' : '지급일로부터 61일까지 사용할 수 있습니다.'}</p>
          </div>
          {editingGrant && <button type="button" className="secondary-button" onClick={resetEditor} disabled={saving}>수정 취소</button>}
        </div>
        <form onSubmit={submit}>
          <label className="field-label">
            지급 대상
            <select className="field-input" value={employeeEmail} onChange={event => setEmployeeEmail(event.target.value)} disabled={Boolean(editingGrant)} required>
              {selectedEmployeeMissing && <option value={employeeEmail}>{editingGrant?.employeeName ?? employeeEmail} · {editingGrant?.employeeStatus === 'ON_LEAVE' ? '휴직' : editingGrant?.employeeStatus === 'RESIGNED' ? '퇴사' : '비활성'}</option>}
              {employees.map(employee => <option key={employee.email} value={employee.email}>{employee.name} · {employee.teamName || '소속 없음'}</option>)}
            </select>
            {editingGrant && <span className="field-help">지급 대상은 수정할 수 없습니다. 대상이 잘못됐다면 잔여를 회수한 뒤 새로 지급해 주세요.</span>}
          </label>
          <div className="form-row-2">
            <label className="field-label">
              지급 일수
              <input className="field-input" type="number" min={editingGrant ? Math.max(0.5, editingGrant.usedDays + editingGrant.reservedDays) : 0.5} max={editingGrant && !editingGrant.employeeActive ? editingGrant.grantedDays : 30} step="0.5" value={grantedDays} onChange={event => setGrantedDays(event.target.value)} required />
            </label>
            <label className="field-label">지급일<input className="field-input" type="date" max={currentDate} value={grantedOn} onChange={event => setGrantedOn(event.target.value)} disabled={Boolean(editingGrant && !editingGrant.employeeActive)} required /></label>
          </div>
          <div className="routing-preview"><b>사용 기한</b><span>{formatDate(grantedOn)} ~ {formatDate(expiresOn)} · 마지막 날 포함</span></div>
          <label className="field-label">
            포상 내용
            <textarea className="field-input" value={memo} maxLength={200} onChange={event => setMemo(event.target.value)} placeholder="예: 프로젝트 완료 기여 포상" required />
          </label>
          {!editingGrant && employees.length === 0 && <p className="form-error">포상 연차를 지급할 수 있는 활성 직원이 없습니다.</p>}
          {message && <p className={isError ? 'form-error' : 'form-success'} role="status">{message}</p>}
          <button className="primary-button" disabled={saving || (!editingGrant && employees.length === 0)}>{saving ? '저장하는 중…' : editingGrant ? '변경 저장' : '포상 연차 지급'}</button>
        </form>
      </section>

      <section className="content-card">
        <div className="card-header"><div><h2>포상 연차 지급 내역</h2><p>지급 건별 사용·예약·회수 상태를 표시합니다.</p></div><span>총 {grants.length}건</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>직원</th><th>지급일</th><th>사용 기한</th><th>지급</th><th>사용</th><th>승인 대기</th><th>잔여</th><th>포상 내용</th><th>상태</th><th>관리</th></tr></thead>
            <tbody>
              {grants.length === 0 ? <tr><td className="table-empty" colSpan={10}>포상 연차 지급 내역이 없습니다.</td></tr> : paginatedGrants.items.map(grant => {
                const expired = grant.expiresOn < currentDate;
                const status = !grant.active
                  ? { label: '회수 완료', className: 'status-cancelled' }
                  : !grant.employeeActive
                    ? { label: grant.employeeStatus === 'ON_LEAVE' ? '직원 휴직' : grant.employeeStatus === 'RESIGNED' ? '직원 퇴사' : '직원 비활성', className: 'status-cancelled' }
                  : expired
                    ? { label: '만료', className: 'status-cancelled' }
                    : grant.remainingDays <= 0 && grant.reservedDays > 0
                      ? { label: '전액 예약', className: 'status-pending' }
                      : grant.remainingDays <= 0
                        ? { label: '사용 완료', className: 'status-approved' }
                        : { label: '사용 가능', className: 'status-approved' };
                return (
                  <tr key={grant.id} className={!grant.active ? 'inactive-row' : undefined}>
                    <td><strong>{grant.employeeName}</strong><span>{grant.employeeEmail}</span></td>
                    <td>{formatDate(grant.grantedOn)}</td>
                    <td>{formatDate(grant.expiresOn)}</td>
                    <td>{formatDays(grant.grantedDays)}일{grant.reclaimedDays > 0 && <span className="cell-subtext">회수 {formatDays(grant.reclaimedDays)}일</span>}</td>
                    <td>{formatDays(grant.usedDays)}일</td>
                    <td>{formatDays(grant.reservedDays)}일</td>
                    <td><b className="balance-value">{formatDays(grant.active && !expired ? grant.remainingDays : 0)}일</b></td>
                    <td>{grant.memo}</td>
                    <td><span className={`status-badge ${status.className}`}>{status.label}</span></td>
                    <td>
                      {grant.active ? (
                        <div className="table-actions">
                          <button type="button" className="secondary-button" onClick={() => beginEdit(grant)} disabled={saving}>수정</button>
                          {!expired && grant.remainingDays > 0 && <button type="button" className="cancel-button" onClick={() => reclaim(grant)} disabled={saving}>잔여 회수</button>}
                        </div>
                      ) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={paginatedGrants.currentPage} totalItems={grants.length} onPageChange={setGrantPage} ariaLabel="포상 연차 지급 내역 페이지" />
      </section>
    </div>
  );
}
