'use client';

import { type FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateAdminLeaveRegistration } from '../lib/admin-leave-registration-policy';
import type { EmployeeBalance, LeaveDuration } from '../lib/leave-store';

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function AdminLeaveRegistration({ employees, currentDate }: { employees: EmployeeBalance[]; currentDate: string }) {
  const router = useRouter();
  const [employeeEmail, setEmployeeEmail] = useState(employees[0]?.email ?? '');
  const [duration, setDuration] = useState<LeaveDuration>('FULL_DAY');
  const [startDate, setStartDate] = useState(currentDate);
  const [endDate, setEndDate] = useState(currentDate);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const registrationKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const employee = employees.find(value => value.email === employeeEmail);
  const preview = validateAdminLeaveRegistration({ employeeEmail, duration, startDate, endDate, reason: reason || '미리보기', registrationKey: '00000000-0000-4000-8000-000000000000' });
  const days = preview.ok ? preview.input.days : 0;
  const projected = employee ? employee.annualNetRemainingDays - days : 0;

  function edit() {
    setFeedback(null);
    registrationKey.current = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    registrationKey.current ??= crypto.randomUUID();
    const validation = validateAdminLeaveRegistration({ employeeEmail, duration, startDate, endDate, reason, registrationKey: registrationKey.current });
    if (!validation.ok) { setFeedback({ error: true, text: validation.error }); return; }
    submitting.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/admin/leave-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validation.input),
      });
      const result = await response.json() as { error?: string; demo?: boolean };
      if (!response.ok) throw new Error(result.error || '연차 사용을 등록하지 못했습니다.');
      setFeedback({ error: false, text: result.demo
        ? '데모 연차 사용을 확정했습니다. 신청 내역, 승인 관리, 기록 관리에서 확인할 수 있습니다.'
        : '연차 사용을 확정했습니다. 신청 내역, 승인 관리, 기록 관리에 반영했습니다.' });
      setReason('');
      registrationKey.current = null;
      router.refresh();
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : '연차 사용을 등록하지 못했습니다.' });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="content-card form-card">
      <div className="card-header"><div><h2>관리자 연차 사용 등록</h2><p>잔액과 관계없이 사용을 즉시 확정합니다. 등록 사유와 처리자가 기록됩니다.</p></div></div>
      <form onSubmit={submit}>
        <fieldset className="admin-registration-fields" disabled={saving}>
          <div className="form-grid-2">
            <label className="field-label">대상 직원
              <select className="field-input" aria-label="대상 직원" value={employeeEmail} required onChange={event => { edit(); setEmployeeEmail(event.target.value); }}>
                {employees.map(value => <option key={value.email} value={value.email}>{value.name} · {value.teamName || '소속 없음'} · 잔여 {formatDays(value.annualNetRemainingDays)}일</option>)}
              </select>
            </label>
            <label className="field-label">사용 단위
              <select className="field-input" aria-label="사용 단위" value={duration} onChange={event => { edit(); const value = event.target.value as LeaveDuration; setDuration(value); if (value !== 'FULL_DAY') setEndDate(startDate); }}>
                <option value="FULL_DAY">종일 연차</option><option value="AM_HALF">오전 반차 · 0.5일</option><option value="PM_HALF">오후 반차 · 0.5일</option>
              </select>
            </label>
            <label className="field-label">사용 시작일<input className="field-input" type="date" required min={employee?.hireDate} value={startDate} onChange={event => { edit(); setStartDate(event.target.value); if (duration !== 'FULL_DAY' || endDate < event.target.value) setEndDate(event.target.value); }} /></label>
            <label className="field-label">사용 종료일<input className="field-input" type="date" required min={startDate} readOnly={duration !== 'FULL_DAY'} value={endDate} onChange={event => { edit(); setEndDate(event.target.value); }} /></label>
          </div>
          <p className="field-help">과거 사용 건도 등록할 수 있습니다. 사용 일수는 주말을 제외하며, 등록 시점의 정기 연차 잔액에서 차감됩니다.</p>
          {preview.ok && employee && <div className="admin-registration-preview"><span>사용 {formatDays(days)}일</span><strong>등록 후 예상 잔여 {formatDays(projected)}일</strong></div>}
          <label className="field-label">관리자 등록 사유<textarea className="field-input" required maxLength={500} value={reason} placeholder="잔액 부족 상태에서 사용을 등록하는 사유를 입력해 주세요." onChange={event => { edit(); setReason(event.target.value); }} /></label>
          {employees.length === 0 && <p className="form-error">등록할 수 있는 활성 직원이 없습니다.</p>}
          {feedback && <p className={feedback.error ? 'form-error' : 'form-success'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
          <button className="primary-button" disabled={saving || !employees.length || !preview.ok}>{saving ? '등록 중…' : '연차 사용 등록 · 즉시 확정'}</button>
        </fieldset>
      </form>
    </section>
  );
}
