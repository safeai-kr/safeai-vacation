'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatKstDateTime } from '../lib/date-format';
import type { AdminOperationRecords, LeaveSource, OperationHistoryItem } from '../lib/leave-store';
import Pagination, { getPageItems } from './Pagination';

const ACTION_LABELS: Record<OperationHistoryItem['action'], string> = {
  APPROVE_REQUEST: '승인',
  REJECT_REQUEST: '반려',
  CANCEL_PENDING_REQUEST: '대기 신청 취소',
  CANCEL_APPROVED_REQUEST: '승인 신청 취소',
  AUTO_APPROVE_REPRESENTATIVE: '대표 자동 승인',
};

const OPERATION_LABELS: Record<string, string> = {
  CREATE_LEAVE_REQUEST: '연차 신청',
  APPROVE_REQUEST: '신청 승인',
  REJECT_REQUEST: '신청 반려',
  CANCEL_REQUEST: '신청 취소',
  UPSERT_EMPLOYEE: '직원 저장',
  UPSERT_TEAM: '팀 저장',
  GRANT_REWARD_LEAVE: '포상 연차 지급',
  UPDATE_REWARD_LEAVE: '포상 연차 수정',
  RECLAIM_REWARD_LEAVE: '포상 연차 회수',
  SYNC_ANNUAL_GRANTS: '연차 자동 계산',
  DASHBOARD_LOAD: '연차 화면 조회',
  DELETE_CALENDAR_EVENT: '캘린더 일정 삭제',
};

const SOURCE_LABELS: Record<LeaveSource, string> = { ANNUAL: '정기 연차', REWARD: '포상휴가' };

function formatPeriod(startDate: string, endDate: string) {
  if (!startDate) return '-';
  return startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
}

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function OperationHistoryManagement({ records }: { records: AdminOperationRecords }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [failurePage, setFailurePage] = useState(1);

  async function resolve(logId: string) {
    setBusyId(logId);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/failure-logs/${logId}/resolve`, { method: 'POST' });
      const result = await response.json() as { error?: string; demo?: boolean };
      if (!response.ok) throw new Error(result.error || '확인 처리하지 못했습니다.');
      setIsError(false);
      setMessage(result.demo ? '데모 확인 처리를 완료했습니다.' : '실패 로그를 확인 처리했습니다.');
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : '확인 처리하지 못했습니다.');
    } finally {
      setBusyId('');
    }
  }

  const unresolvedCount = records.failures.filter(log => !log.resolvedAt).length;
  const paginatedHistory = getPageItems(records.history, historyPage);
  const paginatedFailures = getPageItems(records.failures, failurePage);

  return (
    <div className="history-layout">
      <section className="content-card">
        <div className="card-header">
          <div><h2>승인·반려·취소 처리 이력</h2><p>최근 감사 로그 200건 범위에서 확인된 상태 처리 기록입니다.</p></div>
          <span>표시 {records.history.length}건</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>처리 시각</th><th>처리</th><th>신청자</th><th>기간</th><th>구분</th><th>처리자</th><th>잔액 처리</th></tr></thead>
            <tbody>
              {records.history.length === 0 ? <tr><td className="table-empty" colSpan={7}>처리 이력이 없습니다.</td></tr> : paginatedHistory.items.map(item => (
                <tr key={item.id}>
                  <td>{formatKstDateTime(item.createdAt)}</td>
                  <td><span className={`status-badge ${item.action === 'REJECT_REQUEST' ? 'status-rejected' : item.action.includes('CANCEL') ? 'status-cancelled' : 'status-approved'}`}>{ACTION_LABELS[item.action]}</span></td>
                  <td><strong>{item.applicantName || '삭제된 직원'}</strong><span>{item.applicantEmail || item.requestId}</span></td>
                  <td>{formatPeriod(item.startDate, item.endDate)}</td>
                  <td>{SOURCE_LABELS[item.source]} · {formatDays(item.days)}일</td>
                  <td>{item.actorEmail || '-'}</td>
                  <td>{item.action === 'CANCEL_PENDING_REQUEST'
                    ? '예약 해제'
                    : item.action === 'CANCEL_APPROVED_REQUEST'
                      ? item.balanceRestored ? '잔여 복구' : '사용량 유지'
                      : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={paginatedHistory.currentPage} totalItems={records.history.length} onPageChange={setHistoryPage} ariaLabel="처리 이력 페이지" />
      </section>

      <section className="content-card">
        <div className="card-header">
          <div><h2>실패 로그</h2><p>저장·승인·취소 등 서버 처리에 실패한 기록입니다. 원인을 확인한 뒤 확인 처리할 수 있습니다.</p></div>
          <span>최근 200건 중 미확인 {unresolvedCount}건</span>
        </div>
        {message && <p className={`${isError ? 'form-error' : 'form-success'} history-message`} role="status">{message}</p>}
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>발생 시각</th><th>작업</th><th>사용자</th><th>대상</th><th>오류</th><th>상태</th><th>관리</th></tr></thead>
            <tbody>
              {records.failures.length === 0 ? <tr><td className="table-empty" colSpan={7}>기록된 실패 로그가 없습니다.</td></tr> : paginatedFailures.items.map(log => (
                <tr key={log.id}>
                  <td>{formatKstDateTime(log.createdAt)}</td>
                  <td>{OPERATION_LABELS[log.operation] ?? log.operation}</td>
                  <td>{log.actorEmail || '-'}</td>
                  <td><strong>{log.targetType || '-'}</strong><span>{log.targetId || '-'}</span></td>
                  <td className="log-message-cell">{log.message}</td>
                  <td>{log.resolvedAt
                    ? <span className="status-badge status-approved">확인 완료</span>
                    : <span className="status-badge status-rejected">미확인</span>}</td>
                  <td>{log.resolvedAt
                    ? <span className="cell-subtext">{log.resolvedBy}<br />{formatKstDateTime(log.resolvedAt)}</span>
                    : <button type="button" className="secondary-button" disabled={busyId === log.id} onClick={() => resolve(log.id)}>{busyId === log.id ? '처리 중…' : '확인 처리'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={paginatedFailures.currentPage} totalItems={records.failures.length} onPageChange={setFailurePage} ariaLabel="실패 로그 페이지" />
      </section>
    </div>
  );
}
