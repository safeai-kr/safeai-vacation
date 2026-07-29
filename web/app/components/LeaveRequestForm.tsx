'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasSufficientLeaveBalance, normalizedAvailableDays } from '../lib/leave-balance-policy';
import type { LeaveDuration, LeaveSource } from '../lib/leave-store';

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function weekdayCount(startDate: string, endDate: string) {
  if (!startDate || !endDate || startDate > endDate) return 0;
  let count = 0;
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count += 1;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export default function LeaveRequestForm({
  employeeRegistered,
  annualRemainingDays,
  rewardRemainingDays,
}: {
  employeeRegistered: boolean;
  annualRemainingDays: number;
  rewardRemainingDays: number;
}) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [source, setSource] = useState<LeaveSource>('ANNUAL');
  const [duration, setDuration] = useState<LeaveDuration>('FULL_DAY');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const validRange = useMemo(() => Boolean(startDate && endDate && startDate <= endDate), [startDate, endDate]);
  const calculatedDays = duration === 'FULL_DAY' ? weekdayCount(startDate, endDate) : 0.5;
  const availableDays = normalizedAvailableDays(source === 'ANNUAL' ? annualRemainingDays : rewardRemainingDays);
  const insufficientBalance = !hasSufficientLeaveBalance(calculatedDays, availableDays);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      const response = await fetch('/api/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate: duration === 'FULL_DAY' ? endDate : startDate, source, duration, reason }),
      });
      const result = await response.json() as { error?: string; demo?: boolean; slackSent?: boolean };
      if (!response.ok) throw new Error(result.error || '신청을 저장하지 못했습니다.');
      setStatus('success');
      setMessage(result.demo
        ? result.slackSent
          ? '데모 승인 요청을 Slack으로 전송했습니다. 실제 Firebase에는 저장되지 않았습니다.'
          : '데모 신청을 확인했습니다. 실제 Firebase에는 저장되지 않았습니다.'
        : '연차 신청이 등록되었습니다.');
      setReason('');
      router.refresh();
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '신청 중 오류가 발생했습니다.');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="form-row-2">
        <label className="field-label">
          차감 휴가
          <select className="field-input" value={source} onChange={event => setSource(event.target.value as LeaveSource)}>
            <option value="ANNUAL">정기 연차 · 잔여 {annualRemainingDays}일</option>
            <option value="REWARD">포상휴가 · 잔여 {rewardRemainingDays}일</option>
          </select>
        </label>
        <label className="field-label">
          사용 단위
          <select className="field-input" value={duration} onChange={event => {
            const value = event.target.value as LeaveDuration;
            setDuration(value);
            if (value !== 'FULL_DAY') setEndDate(startDate);
          }}>
            <option value="FULL_DAY">연차</option>
            <option value="AM_HALF">오전 반차</option>
            <option value="PM_HALF">오후 반차</option>
          </select>
        </label>
      </div>

      <div className="form-row-2">
        <label className="field-label">
          시작일
          <input className="field-input" type="date" value={startDate} onChange={event => {
            setStartDate(event.target.value);
            if (duration !== 'FULL_DAY') setEndDate(event.target.value);
          }} required />
        </label>
        <label className="field-label">
          종료일
          <input className="field-input" type="date" value={duration === 'FULL_DAY' ? endDate : startDate} min={startDate} onChange={event => setEndDate(event.target.value)} disabled={duration !== 'FULL_DAY'} required />
        </label>
      </div>

      <div className="routing-preview">
        <b>자동 계산</b>
        <span>주말 제외 {calculatedDays}일 · {source === 'ANNUAL' ? '정기 연차' : '포상휴가'}에서 차감</span>
      </div>

      <label className="field-label">
        상세 사유
        <textarea
          className="field-input min-h-24 resize-none"
          value={reason}
          maxLength={500}
          onChange={event => setReason(event.target.value)}
          placeholder="승인 담당자에게 전달할 사유를 입력해 주세요."
          required
        />
        <span className="field-help">본인, 담당 승인자, 관리자만 확인할 수 있습니다.</span>
      </label>

      {!validRange && <p className="form-error">종료일은 시작일보다 빠를 수 없습니다.</p>}
      {calculatedDays === 0 && validRange && <p className="form-error">선택한 기간에 사용 가능한 평일이 없습니다.</p>}
      {calculatedDays > 0 && insufficientBalance && <p className="form-error">{source === 'ANNUAL' ? '정기 연차' : '포상휴가'} 잔여 {availableDays}일보다 많이 신청할 수 없습니다.</p>}
      {!employeeRegistered && <p className="form-error">직원 등록이 완료되지 않았습니다. 관리자에게 등록을 요청해 주세요.</p>}
      {message && <p className={status === 'error' ? 'form-error' : 'form-success'} role="status">{message}</p>}

      <button type="submit" disabled={!validRange || calculatedDays === 0 || insufficientBalance || !employeeRegistered || status === 'loading'} className="primary-button w-full">
        {status === 'loading' ? '신청을 저장하는 중…' : '승인 요청 보내기'}
      </button>
    </form>
  );
}
