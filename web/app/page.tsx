export const dynamic = 'force-dynamic';

import CancelRequestButton from './components/CancelRequestButton';
import DecisionButtons from './components/DecisionButtons';
import EmployeeManagement from './components/EmployeeManagement';
import LeaveRequestForm from './components/LeaveRequestForm';
import OperationHistoryManagement from './components/OperationHistoryManagement';
import PaginatedList from './components/PaginatedList';
import RewardLeaveManagement from './components/RewardLeaveManagement';
import { isDemoMode, requireCompanyAccess } from './lib/auth';
import { fetchAdminOperationRecords, fetchLeaveDashboard, LeaveDuration, LeaveRequest, LeaveSource, LeaveStatus } from './lib/leave-store';

type Tab = 'overview' | 'requests' | 'approvals' | 'rewards' | 'employees' | 'history';
type CancellableRequest = LeaveRequest & { status: Extract<LeaveStatus, 'PENDING' | 'APPROVED'> };

const STATUS_COPY: Record<LeaveStatus, { label: string; className: string }> = {
  PENDING: { label: '승인 대기', className: 'status-pending' },
  APPROVED: { label: '승인', className: 'status-approved' },
  REJECTED: { label: '반려', className: 'status-rejected' },
  CANCELLED: { label: '취소', className: 'status-cancelled' },
};

const SOURCE_COPY: Record<LeaveSource, string> = { ANNUAL: '정기 연차', REWARD: '포상휴가' };
const DURATION_COPY: Record<LeaveDuration, string> = { FULL_DAY: '연차', AM_HALF: '오전 반차', PM_HALF: '오후 반차' };
const POSITION_COPY = { EMPLOYEE: '직원', TEAM_LEAD: '팀장', REPRESENTATIVE: '대표' } as const;

function formatDays(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [, month, day] = value.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

function formatPeriod(startDate: string, endDate: string) {
  return startDate === endDate ? formatDate(startDate) : `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
}

function formatTimestampDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export default async function LeaveDashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const session = await requireCompanyAccess(params.tab ? `/?tab=${encodeURIComponent(params.tab)}` : '/');
  const requestedTab = params.tab as Tab | undefined;
  const dashboard = await fetchLeaveDashboard(session.email);
  const activeTab: Tab = requestedTab === 'requests'
    || (requestedTab === 'approvals' && dashboard.viewer.canApprove)
    || (requestedTab === 'rewards' && dashboard.viewer.canGrantReward)
    || (requestedTab === 'employees' && dashboard.viewer.isAdmin)
    || (requestedTab === 'history' && dashboard.viewer.isAdmin)
    ? requestedTab
    : 'overview';
  const operationRecords = activeTab === 'history'
    ? await fetchAdminOperationRecords(session.email, dashboard.requests)
    : null;
  const myBalance = dashboard.balances.find(balance => balance.email === session.email);
  const myRequests = dashboard.requests.filter(request => request.applicantEmail === session.email);
  const pendingRequests = dashboard.requests.filter(request => request.status === 'PENDING' && request.approverEmail === session.email);
  const recentRequests = dashboard.requests.filter(request => request.status === 'PENDING' || request.status === 'APPROVED').slice(0, 10);
  const adminCancelableRequests = dashboard.viewer.isAdmin
    ? dashboard.requests.filter((request): request is CancellableRequest => (request.status === 'PENDING' || request.status === 'APPROVED') && request.canCancel)
    : [];
  const rewardEligibleEmployees = dashboard.rewardGrantEmployees;

  if (!dashboard.connected) {
    return (
      <section className="empty-state max-w-2xl mx-auto">
        <h1>연차 데이터를 불러오지 못했습니다.</h1>
        <p>{dashboard.error}</p>
        <div className="setup-list">
          <span>1</span><p>진단 코드: <code>{dashboard.connectionDiagnostic?.code ?? 'FIREBASE_UNKNOWN'}</code></p>
          {dashboard.connectionDiagnostic?.expectedPrincipal && (
            <>
              <span>2</span><p>예상 IAM 주체: <code>{dashboard.connectionDiagnostic.expectedPrincipal}</code></p>
            </>
          )}
          {dashboard.connectionDiagnostic?.oidcIssuer && (
            <>
              <span>3</span><p>OIDC Issuer: <code>{dashboard.connectionDiagnostic.oidcIssuer}</code></p>
            </>
          )}
          <span>!</span><p>민감한 토큰과 환경변수 값은 화면에 표시하지 않습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h1>연차 관리</h1>
          <p>{new Date().getFullYear()}년 연차 현황 및 신청 내역</p>
        </div>
        {isDemoMode() && <span className="demo-notice">데모 모드 · 실제 저장 안 됨</span>}
      </div>

      <nav className="tab-nav" aria-label="연차 관리 메뉴">
        <a href="/?tab=overview" className={activeTab === 'overview' ? 'active' : ''}>연차 현황</a>
        <a href="/?tab=requests" className={activeTab === 'requests' ? 'active' : ''}>신청 내역</a>
        {dashboard.viewer.canApprove && (
          <a href="/?tab=approvals" className={activeTab === 'approvals' ? 'active' : ''}>
            승인 관리
            {pendingRequests.length > 0 && <span>{pendingRequests.length}</span>}
          </a>
        )}
        {dashboard.viewer.canGrantReward && <a href="/?tab=rewards" className={activeTab === 'rewards' ? 'active' : ''}>포상 연차</a>}
        {dashboard.viewer.isAdmin && <a href="/?tab=employees" className={activeTab === 'employees' ? 'active' : ''}>직원 관리</a>}
        {dashboard.viewer.isAdmin && <a href="/?tab=history" className={activeTab === 'history' ? 'active' : ''}>기록 관리</a>}
      </nav>

      {activeTab === 'overview' && (
        <div className="tab-content">
          <section className="summary-grid">
            <article className="summary-card primary-summary">
              <span>잔여 정기 연차</span>
              <strong>{myBalance ? formatDays(myBalance.annualRemainingDays) : '—'}<small>일</small></strong>
            </article>
            <article className="summary-card">
              <span>잔여 포상휴가</span>
              <strong>{myBalance ? formatDays(myBalance.rewardRemainingDays) : '—'}<small>일</small></strong>
            </article>
            <article className="summary-card">
              <span>사용 정기 연차</span>
              <strong>{myBalance ? formatDays(myBalance.annualUsedDays) : '—'}<small>일</small></strong>
            </article>
            <article className="summary-card">
              <span>승인 대기</span>
              <strong>{myBalance ? formatDays(myBalance.annualPendingDays + myBalance.rewardPendingDays) : '—'}<small>일</small></strong>
            </article>
          </section>

          <section className="content-card">
            <div className="card-header">
              <div>
                <h2>{dashboard.viewer.isAdmin ? '구성원 연차 현황' : '나의 연차 상세'}</h2>
                <p>입사일 자동 부여, 기존 사용분, 승인 대기 예약을 반영합니다.</p>
              </div>
              <span>{dashboard.viewer.isAdmin ? `총 ${dashboard.balances.length}명` : '본인만 조회 가능'}</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>구성원</th><th>소속</th><th>정기 부여</th><th>정기 사용</th><th>승인 대기</th><th>정기 잔여</th><th>포상 잔여</th></tr>
                </thead>
                <tbody>
                  {dashboard.balances.map(balance => (
                    <tr key={balance.email}>
                      <td><strong>{balance.name}</strong><span>{POSITION_COPY[balance.position]}</span></td>
                      <td>{balance.teamName || '-'}</td>
                      <td>{formatDays(balance.annualGrantedDays)}일</td>
                      <td>{formatDays(balance.annualUsedDays)}일</td>
                      <td>{balance.annualPendingDays + balance.rewardPendingDays > 0 ? `${formatDays(balance.annualPendingDays + balance.rewardPendingDays)}일` : '-'}</td>
                      <td><b className="balance-value">{formatDays(balance.annualRemainingDays)}일</b></td>
                      <td>{formatDays(balance.rewardRemainingDays)}일</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="content-card">
            <div className="card-header">
              <div><h2>최근 연차 일정</h2><p>승인 대기 및 승인된 신청을 표시합니다.</p></div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>구성원</th><th>기간</th><th>차감 휴가</th><th>사용 단위</th><th>상태</th></tr></thead>
                <tbody>
                  {recentRequests.length === 0 ? (
                    <tr><td colSpan={5} className="table-empty">등록된 연차 일정이 없습니다.</td></tr>
                  ) : recentRequests.map(request => (
                    <tr key={request.requestId}>
                      <td><strong>{request.applicantName}</strong></td>
                      <td>{formatPeriod(request.startDate, request.endDate)} · {formatDays(request.days)}일</td>
                      <td>{SOURCE_COPY[request.source]}</td>
                      <td>{DURATION_COPY[request.duration]}</td>
                      <td><span className={`status-badge ${STATUS_COPY[request.status].className}`}>{STATUS_COPY[request.status].label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'requests' && (
        <div className="tab-content request-layout">
          <section className="content-card form-card">
            <div className="card-header"><div><h2>연차 신청</h2><p>기간을 선택하면 주말을 제외해 사용 일수를 자동 계산합니다.</p></div></div>
            <LeaveRequestForm employeeRegistered={dashboard.viewer.registered} annualRemainingDays={myBalance?.annualRemainingDays ?? 0} rewardRemainingDays={myBalance?.rewardRemainingDays ?? 0} />
          </section>

          <section className="content-card">
            <div className="card-header"><div><h2>나의 신청 내역</h2><p>최근 신청 순서로 표시합니다.</p></div><span>총 {myRequests.length}건</span></div>
            <PaginatedList className="request-list" emptyText="신청 내역이 없습니다." ariaLabel="나의 신청 내역 페이지">
              {myRequests.map(request => (
                <article className="request-row" key={request.requestId}>
                  <div className="request-main">
                    <div>
                      <strong>{formatPeriod(request.startDate, request.endDate)}</strong>
                      <span>{SOURCE_COPY[request.source]} · {DURATION_COPY[request.duration]} · {formatDays(request.days)}일</span>
                    </div>
                    <span className={`status-badge ${STATUS_COPY[request.status].className}`}>{STATUS_COPY[request.status].label}</span>
                  </div>
                  {request.reason && (
                    <div className="request-notes">
                      <p><b>상세 사유</b>{request.reason}</p>
                      {request.status === 'CANCELLED' && !request.cancellationBalanceRestored && (
                        <p><b>취소 처리</b>사용량과 잔여 휴가는 유지됨</p>
                      )}
                    </div>
                  )}
                  <div className="request-footer">
                    <div className="request-meta">
                      신청일 {request.createdAt ? formatTimestampDate(request.createdAt) : '-'}
                      {request.cancelledAt && <> · 취소일 {formatTimestampDate(request.cancelledAt)}</>}
                    </div>
                    {request.canCancel && (request.status === 'PENDING' || (request.status === 'APPROVED' && request.cancelBalanceWillRestore)) && (
                      <CancelRequestButton
                        requestId={request.requestId}
                        requestLabel={formatPeriod(request.startDate, request.endDate)}
                        status={request.status}
                        balanceWillRestore={request.cancelBalanceWillRestore}
                      />
                    )}
                  </div>
                </article>
              ))}
            </PaginatedList>
          </section>
        </div>
      )}

      {activeTab === 'approvals' && dashboard.viewer.canApprove && (
        <div className="tab-content">
          <section className="content-card">
            <div className="card-header"><div><h2>승인 대기 내역</h2><p>상세 사유를 확인한 후 승인 또는 반려해 주세요.</p></div><span>대기 {pendingRequests.length}건</span></div>
            <PaginatedList className="approval-list" emptyText="현재 승인 대기 중인 신청이 없습니다." ariaLabel="승인 대기 내역 페이지">
              {pendingRequests.map(request => (
                <article className="approval-row" key={request.requestId}>
                  <div className="approval-info">
                    <div className="approval-user"><strong>{request.applicantName}</strong><span>{request.applicantEmail}</span></div>
                    <dl>
                      <div><dt>기간</dt><dd>{formatPeriod(request.startDate, request.endDate)}</dd></div>
                      <div><dt>구분</dt><dd>{SOURCE_COPY[request.source]} · {DURATION_COPY[request.duration]} · {formatDays(request.days)}일</dd></div>
                      <div><dt>상세 사유</dt><dd>{request.reason || '-'}</dd></div>
                    </dl>
                  </div>
                  <div className="approval-actions"><DecisionButtons requestId={request.requestId} /></div>
                </article>
              ))}
            </PaginatedList>
          </section>

          {dashboard.viewer.isAdmin && (
            <section className="content-card">
              <div className="card-header">
                <div>
                  <h2>전체 신청 취소</h2>
                  <p>대기 신청은 예약을 해제하고, 승인된 신청은 사용 시작 전까지만 잔여 휴가를 복구합니다.</p>
                </div>
                <span>처리 가능 {adminCancelableRequests.length}건</span>
              </div>
              <PaginatedList className="approval-list" emptyText="관리자가 취소할 수 있는 신청 내역이 없습니다." ariaLabel="전체 신청 취소 내역 페이지">
                {adminCancelableRequests.map(request => (
                  <article className="approval-row" key={request.requestId}>
                    <div className="approval-info">
                      <div className="approval-user"><strong>{request.applicantName}</strong><span>{request.applicantEmail}</span></div>
                      <dl>
                        <div><dt>기간</dt><dd>{formatPeriod(request.startDate, request.endDate)}</dd></div>
                        <div><dt>구분</dt><dd>{SOURCE_COPY[request.source]} · {DURATION_COPY[request.duration]} · {formatDays(request.days)}일</dd></div>
                        <div><dt>취소 처리</dt><dd>{request.status === 'PENDING' ? '승인 대기 예약 해제' : request.cancelBalanceWillRestore ? '잔여 휴가 복구' : '사용량 유지 · 신청 상태만 취소'}</dd></div>
                        <div><dt>상세 사유</dt><dd>{request.reason || '-'}</dd></div>
                      </dl>
                    </div>
                    <div className="approval-actions">
                      <CancelRequestButton
                        requestId={request.requestId}
                        requestLabel={`${request.applicantName} ${formatPeriod(request.startDate, request.endDate)}`}
                        status={request.status}
                        balanceWillRestore={request.cancelBalanceWillRestore}
                        adminMode
                      />
                    </div>
                  </article>
                ))}
              </PaginatedList>
            </section>
          )}
        </div>
      )}

      {activeTab === 'rewards' && dashboard.viewer.canGrantReward && (
        <div className="tab-content">
          <RewardLeaveManagement employees={rewardEligibleEmployees} grants={dashboard.rewardGrants} />
        </div>
      )}

      {activeTab === 'employees' && dashboard.viewer.isAdmin && (
        <div className="tab-content">
          <EmployeeManagement teams={dashboard.teams} employees={dashboard.adminEmployees} />
        </div>
      )}

      {activeTab === 'history' && dashboard.viewer.isAdmin && operationRecords && (
        <div className="tab-content">
          <OperationHistoryManagement records={operationRecords} />
        </div>
      )}
    </div>
  );
}
