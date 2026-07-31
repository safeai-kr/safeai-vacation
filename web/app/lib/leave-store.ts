import 'server-only';

import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { isDemoMode } from './auth';
import { adminErrorDiagnostic, DomainError as Error } from './api-error';
import { resolveApprovalRoute, type ApprovalRouteError } from './approval-routing-policy';
import { diagnoseFirebaseConnection, firestore, type FirebaseConnectionDiagnostic } from './firebase-admin';
import { hasSufficientLeaveBalance, normalizedAvailableDays } from './leave-balance-policy';
import { firstLeaveUsageDate, resolveCancellationPolicy } from './leave-cancellation-policy';
import { calculateRewardReclaim, validateRewardGrantAdjustment } from './reward-grant-policy';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type Position = 'EMPLOYEE' | 'TEAM_LEAD' | 'REPRESENTATIVE';
export type Permission = 'GENERAL' | 'ADMIN';
export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED' | 'INACTIVE';
export type LeaveSource = 'ANNUAL' | 'REWARD';
export type LeaveDuration = 'FULL_DAY' | 'AM_HALF' | 'PM_HALF';

export interface LeaveIntegrationRequest {
  requestId: string;
  applicantEmail: string;
  applicantName: string;
  approverEmail: string;
  approverSlackUserId: string;
  source: LeaveSource;
  duration: LeaveDuration;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  slackChannelId?: string;
  slackMessageTs?: string;
}

export interface Employee {
  email: string;
  name: string;
  hireDate: string;
  teamId: string;
  teamName: string;
  position: Position;
  permission: Permission;
  slackUserId: string;
  active: boolean;
  employmentStatus: EmployeeStatus;
  profileStatus: 'COMPLETE' | 'INCOMPLETE';
}

export interface Team {
  id: string;
  name: string;
  managerEmail: string;
  active: boolean;
}

export interface EmployeeBalance extends Employee {
  openingAnnualUsedDays: number;
  annualGrantedDays: number;
  annualUsedDays: number;
  annualPendingDays: number;
  annualRemainingDays: number;
  rewardGrantedDays: number;
  rewardUsedDays: number;
  rewardPendingDays: number;
  rewardRemainingDays: number;
  effectiveApproverEmail: string;
  effectiveApproverName: string;
}

export interface RewardGrantEmployeeOption {
  email: string;
  name: string;
  teamName: string;
}

export interface LeaveRequest {
  requestId: string;
  applicantEmail: string;
  applicantName: string;
  approverEmail: string;
  approverName: string;
  source: LeaveSource;
  duration: LeaveDuration;
  startDate: string;
  endDate: string;
  workDates: string[];
  days: number;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
  decidedAt: string;
  cancelledAt: string;
  cancelledBy: string;
  cancellationBalanceRestored: boolean;
  canCancel: boolean;
  cancelBalanceWillRestore: boolean;
}

export interface LeaveDashboard {
  connected: boolean;
  source: 'firebase' | 'demo';
  error?: string;
  connectionDiagnostic?: FirebaseConnectionDiagnostic;
  balances: EmployeeBalance[];
  adminEmployees: EmployeeBalance[];
  rewardGrantEmployees: RewardGrantEmployeeOption[];
  requests: LeaveRequest[];
  rewardGrants: RewardGrantView[];
  teams: Team[];
  viewer: {
    email: string;
    registered: boolean;
    isAdmin: boolean;
    canApprove: boolean;
    canGrantReward: boolean;
    rewardGrantEmployeeEmails: string[];
  };
}

export interface NewLeaveRequestInput {
  source: LeaveSource;
  duration: LeaveDuration;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface EmployeeInput {
  email: string;
  name: string;
  hireDate: string;
  teamId: string;
  position: Position;
  permission: Permission;
  slackUserId: string;
  replacementManagerEmail: string;
  employmentStatus: EmployeeStatus;
  openingAnnualUsedDays: number;
}

export interface RewardGrantView {
  id: string;
  employeeEmail: string;
  employeeName: string;
  employeeActive: boolean;
  employeeStatus: EmployeeStatus;
  grantedDays: number;
  usedDays: number;
  reservedDays: number;
  remainingDays: number;
  grantedOn: string;
  expiresOn: string;
  memo: string;
  createdBy: string;
  createdAt: string;
  active: boolean;
  reclaimedDays: number;
  reclaimedAt: string;
  reclaimedBy: string;
  updatedAt: string;
  updatedBy: string;
  mutationVersion: number;
}

export interface RewardGrantInput {
  employeeEmail: string;
  grantedDays: number;
  grantedOn: string;
  memo: string;
}

export interface RewardGrantUpdateInput {
  grantedDays: number;
  grantedOn: string;
  memo: string;
  expectedMutationVersion: number;
}

interface AnnualGrantEvent {
  key: string;
  days: number;
  effectiveDate: string;
  entryType: 'AUTO_MONTHLY_GRANT' | 'AUTO_FIRST_YEAR_GRANT' | 'AUTO_SENIORITY_GRANT';
  reason: string;
  resetsPreviousBalance: boolean;
}

interface RewardGrant {
  id: string;
  employeeEmail: string;
  grantedDays: number;
  grantedOn: string;
  expiresOn: string;
  memo: string;
  createdBy: string;
  createdAt: string;
  active: boolean;
  reclaimedDays: number;
  reclaimedAt: string;
  reclaimedBy: string;
  updatedAt: string;
  updatedBy: string;
  mutationVersion: number;
}

export interface OperationHistoryItem {
  id: string;
  action: 'APPROVE_REQUEST' | 'REJECT_REQUEST' | 'CANCEL_PENDING_REQUEST' | 'CANCEL_APPROVED_REQUEST' | 'AUTO_APPROVE_REPRESENTATIVE';
  actorEmail: string;
  requestId: string;
  applicantEmail: string;
  applicantName: string;
  startDate: string;
  endDate: string;
  source: LeaveSource;
  days: number;
  balanceRestored: boolean;
  createdAt: string;
}

export interface OperationFailureLog {
  id: string;
  correlationId: string;
  operation: string;
  actorEmail: string;
  targetType: string;
  targetId: string;
  message: string;
  createdAt: string;
  resolvedAt: string;
  resolvedBy: string;
}

export interface AdminOperationRecords {
  history: OperationHistoryItem[];
  failures: OperationFailureLog[];
}

interface RewardAllocation {
  rewardGrantId: string;
  requestId: string;
  employeeEmail: string;
  usageDate: string;
  days: number;
  status: 'RESERVED' | 'USED' | 'CANCELLED';
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizedEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function isConfiguredCompanyEmail(value: unknown) {
  const email = normalizedEmail(value);
  const domain = (process.env.GOOGLE_AUTH_DOMAIN ?? 'safeai.kr').trim().toLowerCase();
  const parts = email.split('@');
  return Boolean(domain)
    && parts.length === 2
    && Boolean(parts[0])
    && !/\s/.test(parts[0])
    && parts[1] === domain;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addMonths(value: string, months: number) {
  const source = parseIsoDate(value);
  const targetMonth = source.getUTCMonth() + months;
  const year = source.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(source.getUTCDate(), daysInMonth(year, month));
  return toIsoDate(new Date(Date.UTC(year, month, day)));
}

function addYears(value: string, years: number) {
  const source = parseIsoDate(value);
  const year = source.getUTCFullYear() + years;
  const month = source.getUTCMonth();
  const day = Math.min(source.getUTCDate(), daysInMonth(year, month));
  return toIsoDate(new Date(Date.UTC(year, month, day)));
}

function kstToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function inclusiveDays(start: string, end: string) {
  return Math.floor((parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / 86_400_000) + 1;
}

function roundUpHalf(value: number) {
  return Math.ceil(value * 2) / 2;
}

function workDates(input: Pick<NewLeaveRequestInput, 'startDate' | 'endDate' | 'duration'>) {
  if (!DATE_PATTERN.test(input.startDate) || !DATE_PATTERN.test(input.endDate) || input.startDate > input.endDate) {
    throw new Error('신청 기간을 확인해 주세요.');
  }
  if (input.duration !== 'FULL_DAY' && input.startDate !== input.endDate) {
    throw new Error('반차는 하루만 선택할 수 있습니다.');
  }
  const dates: string[] = [];
  for (let current = input.startDate; current <= input.endDate; current = addDays(current, 1)) {
    const day = parseIsoDate(current).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(current);
  }
  if (dates.length === 0) throw new Error('주말에는 휴가를 신청할 수 없습니다.');
  return dates;
}

function annualGrantEvents(hireDate: string, asOf = kstToday()): AnnualGrantEvent[] {
  if (!DATE_PATTERN.test(hireDate) || hireDate > asOf) return [];
  const events: AnnualGrantEvent[] = [];
  for (let month = 1; month <= 11; month += 1) {
    const effectiveDate = addMonths(hireDate, month);
    if (effectiveDate > asOf) break;
    events.push({
      key: `MONTHLY:${hireDate}:${month}`,
      days: 1,
      effectiveDate,
      entryType: 'AUTO_MONTHLY_GRANT',
      reason: `입사 후 ${month}개월 개근 자동 부여`,
      resetsPreviousBalance: false,
    });
  }

  const firstAnniversary = addYears(hireDate, 1);
  if (firstAnniversary <= asOf) {
    const hireYear = Number(hireDate.slice(0, 4));
    const workedDays = inclusiveDays(hireDate, `${hireYear}-12-31`);
    const proratedDays = roundUpHalf((workedDays / (isLeapYear(hireYear) ? 366 : 365)) * 15);
    events.push({
      key: `FIRST_YEAR:${hireDate}`,
      days: proratedDays,
      effectiveDate: firstAnniversary,
      entryType: 'AUTO_FIRST_YEAR_GRANT',
      reason: `입사연도 ${workedDays}일 근무 비례 연차`,
      resetsPreviousBalance: true,
    });
  }

  const hireYear = Number(hireDate.slice(0, 4));
  const currentYear = Number(asOf.slice(0, 4));
  for (let year = hireYear + 2; year <= currentYear; year += 1) {
    const effectiveDate = `${year}-01-01`;
    if (effectiveDate > asOf) break;
    const yearDifference = year - hireYear;
    const days = Math.min(15 + (yearDifference - 2), 25);
    events.push({
      key: `SENIORITY:${hireDate}:${year}`,
      days,
      effectiveDate,
      entryType: 'AUTO_SENIORITY_GRANT',
      reason: `${year}년 1월 1일 근속 연차 자동 부여`,
      resetsPreviousBalance: true,
    });
  }
  return events;
}

function bootstrapAdmins() {
  return (process.env.FIREBASE_ADMIN_EMAILS ?? '').split(',').map(normalizedEmail).filter(Boolean);
}

function isBootstrapAdmin(email: string) {
  return bootstrapAdmins().includes(normalizedEmail(email));
}

function parseTeam(id: string, data: FirebaseFirestore.DocumentData): Team {
  return {
    id,
    name: String(data.name ?? id),
    managerEmail: normalizedEmail(data.managerEmail),
    active: data.active !== false,
  };
}

function parseEmployee(data: FirebaseFirestore.DocumentData): Employee {
  const active = data.active !== false;
  const storedStatus = String(data.employmentStatus ?? '');
  const employmentStatus: EmployeeStatus = active
    ? 'ACTIVE'
    : ['ON_LEAVE', 'RESIGNED', 'INACTIVE'].includes(storedStatus)
      ? storedStatus as EmployeeStatus
      : 'INACTIVE';
  return {
    email: normalizedEmail(data.email),
    name: String(data.name ?? ''),
    hireDate: String(data.hireDate ?? ''),
    teamId: String(data.teamId ?? ''),
    teamName: '',
    position: (data.position ?? data.organizationRole ?? 'EMPLOYEE') as Position,
    permission: (data.permission ?? (data.isAdmin ? 'ADMIN' : 'GENERAL')) as Permission,
    slackUserId: String(data.slackUserId ?? '').trim(),
    active,
    employmentStatus,
    profileStatus: data.profileStatus === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE',
  };
}

function parseRequest(id: string, data: FirebaseFirestore.DocumentData): LeaveRequest {
  return {
    requestId: id,
    applicantEmail: normalizedEmail(data.applicantEmail),
    applicantName: String(data.applicantName ?? ''),
    approverEmail: normalizedEmail(data.approverEmail),
    approverName: String(data.approverName ?? ''),
    source: data.source === 'REWARD' ? 'REWARD' : 'ANNUAL',
    duration: ['AM_HALF', 'PM_HALF'].includes(data.duration) ? data.duration : 'FULL_DAY',
    startDate: String(data.startDate ?? ''),
    endDate: String(data.endDate ?? ''),
    workDates: Array.isArray(data.workDates) ? data.workDates.map(String) : [],
    days: numberValue(data.days),
    reason: String(data.reason ?? ''),
    status: (data.status ?? 'PENDING') as LeaveStatus,
    createdAt: dateValue(data.createdAt),
    decidedAt: dateValue(data.decidedAt),
    cancelledAt: dateValue(data.cancelledAt),
    cancelledBy: normalizedEmail(data.cancelledBy),
    cancellationBalanceRestored: data.cancellationBalanceRestored === true,
    canCancel: false,
    cancelBalanceWillRestore: false,
  };
}

function parseRewardGrant(id: string, data: FirebaseFirestore.DocumentData): RewardGrant {
  return {
    id,
    employeeEmail: normalizedEmail(data.employeeEmail),
    grantedDays: numberValue(data.grantedDays),
    grantedOn: String(data.grantedOn ?? ''),
    expiresOn: String(data.expiresOn ?? ''),
    memo: String(data.memo ?? ''),
    createdBy: normalizedEmail(data.createdBy),
    createdAt: dateValue(data.createdAt),
    active: data.active !== false,
    reclaimedDays: numberValue(data.reclaimedDays),
    reclaimedAt: dateValue(data.reclaimedAt),
    reclaimedBy: normalizedEmail(data.reclaimedBy),
    updatedAt: dateValue(data.updatedAt),
    updatedBy: normalizedEmail(data.updatedBy),
    mutationVersion: numberValue(data.mutationVersion),
  };
}

function isEligibleEmployeeData(data: FirebaseFirestore.DocumentData | undefined, email: string) {
  return Boolean(data)
    && isConfiguredCompanyEmail(email)
    && data?.active !== false
    && data?.profileStatus === 'COMPLETE';
}

function isActiveAdminData(data: FirebaseFirestore.DocumentData | undefined) {
  const permission = data?.permission ?? (data?.isAdmin ? 'ADMIN' : 'GENERAL');
  return Boolean(data) && data?.active !== false && data?.profileStatus === 'COMPLETE' && permission === 'ADMIN';
}

function bootstrapAdminAllowed(email: string, data: FirebaseFirestore.DocumentData | undefined) {
  return isBootstrapAdmin(email)
    && data?.active !== false
    && (!data || data.profileStatus !== 'COMPLETE');
}

function hasAdminAccess(email: string, data: FirebaseFirestore.DocumentData | undefined) {
  return bootstrapAdminAllowed(email, data) || isActiveAdminData(data);
}

function allowLocalSelfApproval() {
  return process.env.NODE_ENV !== 'production' && process.env.LOCAL_AUTH_BYPASS === 'true';
}

function parseAllocation(data: FirebaseFirestore.DocumentData): RewardAllocation {
  return {
    rewardGrantId: String(data.rewardGrantId ?? ''),
    requestId: String(data.requestId ?? ''),
    employeeEmail: normalizedEmail(data.employeeEmail),
    usageDate: String(data.usageDate ?? ''),
    days: numberValue(data.days),
    status: (data.status ?? 'RESERVED') as RewardAllocation['status'],
  };
}

const APPROVAL_ROUTE_ERROR_MESSAGES: Record<ApprovalRouteError, string> = {
  TEAM_REQUIRED: '직원은 활성 소속 팀을 지정해야 합니다.',
  TEAM_MANAGER_REQUIRED: '소속 팀의 팀장이 지정되지 않았습니다.',
  TEAM_MANAGER_INELIGIBLE: '소속 팀에 등록이 완료된 활성 팀장을 지정해 주세요.',
  TEAM_MANAGER_NOT_TEAM_LEAD: '소속 팀 승인자는 직책이 팀장인 직원이어야 합니다.',
  SELF_APPROVAL: '직원은 본인의 신청을 직접 승인할 수 없습니다. 소속 팀장을 변경해 주세요.',
  REPRESENTATIVE_REQUIRED: '팀장 신청을 승인할 활성 대표를 먼저 등록해 주세요.',
  MULTIPLE_REPRESENTATIVES: '활성 대표가 여러 명입니다. 대표 직책은 한 명만 유지해 주세요.',
};

function requiredApprover(employee: Employee, teams: Team[], employees: Employee[]) {
  const route = resolveApprovalRoute(employee, teams, employees, allowLocalSelfApproval());
  if (!route.ok) throw new Error(APPROVAL_ROUTE_ERROR_MESSAGES[route.error]);
  return route.approver;
}

function effectiveApprover(employee: Employee, teams: Team[], employees: Employee[]) {
  const route = resolveApprovalRoute(employee, teams, employees, allowLocalSelfApproval());
  if (!route.ok) return { email: '', name: '' };
  return { email: route.approver.email, name: route.approver.name };
}

function cancellationAccess(request: LeaveRequest, viewerEmail: string, isAdmin: boolean, today = kstToday()) {
  const firstUsageDate = firstLeaveUsageDate(request.workDates, request.startDate);
  return resolveCancellationPolicy({
    status: request.status,
    isApplicant: request.applicantEmail === normalizedEmail(viewerEmail),
    isAdmin,
    firstUsageDate,
    today,
  });
}

function ledgerId(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function syncAnnualGrants(employeeEmail: string) {
  const db = firestore();
  const email = normalizedEmail(employeeEmail);

  await db.runTransaction(async transaction => {
    const employeeSnapshot = await transaction.get(db.collection('employees').doc(email));
    if (!employeeSnapshot.exists || !isEligibleEmployeeData(employeeSnapshot.data(), email)) return;
    const currentHireDate = String(employeeSnapshot.data()?.hireDate ?? '');
    if (!currentHireDate) return;
    const events = annualGrantEvents(currentHireDate).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    if (events.length === 0) return;
    const ledgerSnapshot = await transaction.get(db.collection('leave_ledger').where('employeeEmail', '==', email));
    const existingIds = new Set(ledgerSnapshot.docs.map(doc => doc.id));
    const simulatedEntries = ledgerSnapshot.docs
      .filter(doc => doc.data().source === 'ANNUAL')
      .map(doc => ({ effectiveDate: String(doc.data().effectiveDate ?? ''), days: numberValue(doc.data().days) }));

    for (const event of events) {
      if (event.resetsPreviousBalance) {
        const expirationKey = `EXPIRATION:${event.key}`;
        const expirationId = ledgerId(`${email}:${expirationKey}`);
        if (!existingIds.has(expirationId)) {
          const previousBalance = simulatedEntries
            .filter(entry => entry.effectiveDate < event.effectiveDate)
            .reduce((sum, entry) => sum + entry.days, 0);
          const expiredDays = Math.max(previousBalance, 0);
          if (expiredDays > 0) {
            transaction.create(db.collection('leave_ledger').doc(expirationId), {
              employeeEmail: email,
              source: 'ANNUAL',
              entryType: 'EXPIRATION',
              days: -expiredDays,
              effectiveDate: event.effectiveDate,
              requestId: '',
              rewardGrantId: '',
              reason: '새 정기 연차 부여 전 미사용 잔여 연차 소멸',
              idempotencyKey: expirationKey,
              createdAt: FieldValue.serverTimestamp(),
              createdBy: 'SYSTEM',
            });
            simulatedEntries.push({ effectiveDate: event.effectiveDate, days: -expiredDays });
          }
        }
      }

      const grantId = ledgerId(`${email}:${event.key}`);
      if (!existingIds.has(grantId)) {
        transaction.create(db.collection('leave_ledger').doc(grantId), {
          employeeEmail: email,
          source: 'ANNUAL',
          entryType: event.entryType,
          days: event.days,
          effectiveDate: event.effectiveDate,
          requestId: '',
          rewardGrantId: '',
          reason: event.reason,
          idempotencyKey: event.key,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'SYSTEM',
        });
        simulatedEntries.push({ effectiveDate: event.effectiveDate, days: event.days });
      }
    }
  });
}

function isRequestConflict(existing: LeaveRequest, duration: LeaveDuration, dates: string[]) {
  const blocksAnotherRequest = ['PENDING', 'APPROVED'].includes(existing.status)
    || (existing.status === 'CANCELLED' && !existing.cancellationBalanceRestored);
  if (!blocksAnotherRequest) return false;
  const overlap = existing.workDates.some(date => dates.includes(date));
  if (!overlap) return false;
  if (duration === 'FULL_DAY' || existing.duration === 'FULL_DAY') return true;
  return duration === existing.duration;
}

function demoDashboard(viewerEmail: string): LeaveDashboard {
  const teams: Team[] = [
    { id: 'platform', name: '플랫폼팀', managerEmail: 'platform.lead@safeai.kr', active: true },
    { id: 'ai-research', name: 'AI Research팀', managerEmail: 'research.lead@safeai.kr', active: true },
    { id: 'strategy-planning', name: '전략기획팀', managerEmail: 'strategy.lead@safeai.kr', active: true },
    { id: 'management-support', name: '경영지원팀', managerEmail: 'support.lead@safeai.kr', active: true },
  ];
  const base: Omit<EmployeeBalance, 'teamName' | 'effectiveApproverEmail' | 'effectiveApproverName'>[] = [
    { email: 'ceo@safeai.kr', name: '김대표', hireDate: '2022-01-03', teamId: '', position: 'REPRESENTATIVE', permission: 'ADMIN', slackUserId: 'UCEO001', active: true, employmentStatus: 'ACTIVE', profileStatus: 'COMPLETE', openingAnnualUsedDays: 0, annualGrantedDays: 17, annualUsedDays: 5, annualPendingDays: 0, annualRemainingDays: 12, rewardGrantedDays: 2, rewardUsedDays: 1, rewardPendingDays: 0, rewardRemainingDays: 1 },
    { email: 'platform.lead@safeai.kr', name: '박팀장', hireDate: '2024-02-01', teamId: 'platform', position: 'TEAM_LEAD', permission: 'GENERAL', slackUserId: 'UPL001', active: true, employmentStatus: 'ACTIVE', profileStatus: 'COMPLETE', openingAnnualUsedDays: 2, annualGrantedDays: 15, annualUsedDays: 7, annualPendingDays: 1, annualRemainingDays: 7, rewardGrantedDays: 1, rewardUsedDays: 0, rewardPendingDays: 0, rewardRemainingDays: 1 },
    { email: 'member@safeai.kr', name: '정직원', hireDate: '2026-01-15', teamId: 'platform', position: 'EMPLOYEE', permission: 'GENERAL', slackUserId: 'UMEMBER01', active: true, employmentStatus: 'ACTIVE', profileStatus: 'COMPLETE', openingAnnualUsedDays: 1, annualGrantedDays: 6, annualUsedDays: 1, annualPendingDays: 1, annualRemainingDays: 4, rewardGrantedDays: 1, rewardUsedDays: 0.5, rewardPendingDays: 0, rewardRemainingDays: 0.5 },
  ];
  const employeeDirectory: Employee[] = base.map(employee => ({
    email: employee.email,
    name: employee.name,
    hireDate: employee.hireDate,
    teamId: employee.teamId,
    teamName: teams.find(team => team.id === employee.teamId)?.name ?? '',
    position: employee.position,
    permission: employee.permission,
    slackUserId: employee.slackUserId,
    active: employee.active,
    employmentStatus: employee.employmentStatus,
    profileStatus: employee.profileStatus,
  }));
  const employees: EmployeeBalance[] = base.map(employee => {
    const full = {
      ...employee,
      teamName: teams.find(team => team.id === employee.teamId)?.name ?? '',
    };
    const approver = effectiveApprover(full, teams, employeeDirectory);
    return { ...full, effectiveApproverEmail: approver.email, effectiveApproverName: approver.name };
  });
  const requests: LeaveRequest[] = [
    { requestId: 'demo-1', applicantEmail: 'member@safeai.kr', applicantName: '정직원', approverEmail: 'platform.lead@safeai.kr', approverName: '박팀장', source: 'ANNUAL', duration: 'FULL_DAY', startDate: '2026-07-20', endDate: '2026-07-20', workDates: ['2026-07-20'], days: 1, reason: '가족 일정', status: 'PENDING', createdAt: '2026-07-14T09:20:00+09:00', decidedAt: '', cancelledAt: '', cancelledBy: '', cancellationBalanceRestored: false, canCancel: false, cancelBalanceWillRestore: false },
  ];
  const rewardGrants: RewardGrantView[] = [
    { id: 'reward-demo-1', employeeEmail: 'member@safeai.kr', employeeName: '정직원', employeeActive: true, employeeStatus: 'ACTIVE', grantedDays: 1, usedDays: 0.5, reservedDays: 0, remainingDays: 0.5, grantedOn: '2026-07-01', expiresOn: '2026-08-31', memo: '프로젝트 기여 포상', createdBy: 'platform.lead@safeai.kr', createdAt: '2026-07-01T09:00:00+09:00', active: true, reclaimedDays: 0, reclaimedAt: '', reclaimedBy: '', updatedAt: '', updatedBy: '', mutationVersion: 1 },
  ];
  const viewer = employees.find(employee => employee.email === viewerEmail) ?? employees[0];
  const isAdmin = viewer.permission === 'ADMIN';
  const managedTeamIds = teams.filter(team => team.managerEmail === viewer.email).map(team => team.id);
  const rewardGrantEmployeeEmails = (isAdmin ? employees : employees.filter(employee => managedTeamIds.includes(employee.teamId))).map(employee => employee.email);
  return {
    connected: true,
    source: 'demo',
    balances: isAdmin ? employees : employees.filter(employee => employee.email === viewer.email),
    adminEmployees: isAdmin ? employees : [],
    rewardGrantEmployees: employees
      .filter(employee => rewardGrantEmployeeEmails.includes(employee.email))
      .map(employee => ({ email: employee.email, name: employee.name, teamName: employee.teamName })),
    teams,
    rewardGrants: rewardGrants.filter(grant => rewardGrantEmployeeEmails.includes(grant.employeeEmail)),
    requests: requests.map(request => {
      const cancellation = cancellationAccess(request, viewer.email, isAdmin);
      return {
        ...request,
        reason: request.applicantEmail === viewer.email || request.approverEmail === viewer.email || isAdmin ? request.reason : '',
        canCancel: cancellation.canCancel,
        cancelBalanceWillRestore: cancellation.balanceWillRestore,
      };
    }),
    viewer: {
      email: viewer.email,
      registered: true,
      isAdmin,
      canApprove: isAdmin || viewer.position === 'REPRESENTATIVE' || teams.some(team => team.managerEmail === viewer.email) || requests.some(request => request.approverEmail === viewer.email),
      canGrantReward: isAdmin || managedTeamIds.length > 0,
      rewardGrantEmployeeEmails,
    },
  };
}

export async function fetchLeaveDashboard(viewerEmail: string): Promise<LeaveDashboard> {
  const email = normalizedEmail(viewerEmail);
  if (isDemoMode()) return demoDashboard(email);

  try {
    const db = firestore();
    const [employeeSnapshot, teamSnapshot] = await Promise.all([
      db.collection('employees').get(),
      db.collection('teams').get(),
    ]);
    const teams = teamSnapshot.docs
      .map(doc => parseTeam(doc.id, doc.data()))
      .filter(team => team.active)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const allEmployees = employeeSnapshot.docs.map(doc => parseEmployee(doc.data()));
    const eligibleEmployees = allEmployees.filter(employee => employee.active && employee.profileStatus === 'COMPLETE');
    await Promise.all(eligibleEmployees.map(employee => syncAnnualGrants(employee.email)));

    const [requestSnapshot, ledgerSnapshot, grantSnapshot, allocationSnapshot] = await Promise.all([
      db.collection('leave_requests').get(),
      db.collection('leave_ledger').get(),
      db.collection('reward_grants').get(),
      db.collection('reward_allocations').get(),
    ]);
    const requests = requestSnapshot.docs.map(doc => parseRequest(doc.id, doc.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const ledger = ledgerSnapshot.docs.map(doc => doc.data());
    const grants = grantSnapshot.docs.map(doc => parseRewardGrant(doc.id, doc.data()));
    const allocations = allocationSnapshot.docs.map(doc => parseAllocation(doc.data()));
    const viewerEmployee = allEmployees.find(employee => employee.email === email);
    const viewerDocumentData = employeeSnapshot.docs.find(doc => normalizedEmail(doc.data().email || doc.id) === email)?.data();
    const viewerIsEligible = Boolean(viewerEmployee?.active && viewerEmployee.profileStatus === 'COMPLETE');
    const isAdmin = hasAdminAccess(email, viewerDocumentData);
    const managedTeamIds = viewerIsEligible ? teams.filter(team => team.managerEmail === email).map(team => team.id) : [];
    const rewardGrantEmployeeEmails = (isAdmin
      ? eligibleEmployees
      : eligibleEmployees.filter(employee => managedTeamIds.includes(employee.teamId)))
      .map(employee => employee.email);
    const visibleRewardGrantEmployeeEmails = (isAdmin
      ? allEmployees
      : eligibleEmployees.filter(employee => managedTeamIds.includes(employee.teamId)))
      .map(employee => employee.email);
    const today = kstToday();

    const balanceForEmployee = (employee: Employee): EmployeeBalance => {
      const employeeLedger = ledger.filter(entry => normalizedEmail(entry.employeeEmail) === employee.email && entry.source === 'ANNUAL');
      const currentPeriodStart = employeeLedger
        .filter(entry => ['AUTO_FIRST_YEAR_GRANT', 'AUTO_SENIORITY_GRANT'].includes(entry.entryType))
        .map(entry => String(entry.effectiveDate ?? ''))
        .sort()
        .at(-1) ?? employee.hireDate;
      const currentPeriodLedger = employeeLedger.filter(entry => String(entry.effectiveDate ?? '') >= currentPeriodStart);
      const annualGrantedDays = currentPeriodLedger.filter(entry => numberValue(entry.days) > 0 && !['RESTORE'].includes(entry.entryType)).reduce((sum, entry) => sum + numberValue(entry.days), 0);
      const annualUsedDays = Math.max(0, -currentPeriodLedger.filter(entry => ['OPENING_USAGE', 'USE', 'RESTORE'].includes(entry.entryType)).reduce((sum, entry) => sum + numberValue(entry.days), 0));
      const annualBalance = employeeLedger.reduce((sum, entry) => sum + numberValue(entry.days), 0);
      const openingAnnualUsedDays = Math.abs(employeeLedger.filter(entry => entry.entryType === 'OPENING_USAGE').reduce((sum, entry) => sum + numberValue(entry.days), 0));
      const annualPendingDays = requests.filter(request => request.applicantEmail === employee.email && request.source === 'ANNUAL' && request.status === 'PENDING').reduce((sum, request) => sum + request.days, 0);
      const employeeGrants = grants.filter(grant => grant.employeeEmail === employee.email && grant.active && grant.grantedOn <= today && grant.expiresOn >= today);
      const validGrantIds = new Set(employeeGrants.map(grant => grant.id));
      const employeeAllocations = allocations.filter(allocation => validGrantIds.has(allocation.rewardGrantId));
      const rewardGrantedDays = employeeGrants.reduce((sum, grant) => sum + grant.grantedDays, 0);
      const rewardUsedDays = employeeAllocations.filter(allocation => allocation.status === 'USED').reduce((sum, allocation) => sum + allocation.days, 0);
      const rewardPendingDays = employeeAllocations.filter(allocation => allocation.status === 'RESERVED').reduce((sum, allocation) => sum + allocation.days, 0);
      const approver = effectiveApprover(employee, teams, allEmployees);
      return {
        ...employee,
        teamName: teams.find(team => team.id === employee.teamId)?.name ?? '',
        openingAnnualUsedDays,
        annualGrantedDays,
        annualUsedDays,
        annualPendingDays,
        annualRemainingDays: annualBalance - annualPendingDays,
        rewardGrantedDays,
        rewardUsedDays,
        rewardPendingDays,
        rewardRemainingDays: rewardGrantedDays - rewardUsedDays - rewardPendingDays,
        effectiveApproverEmail: approver.email,
        effectiveApproverName: approver.name,
      };
    };
    const allBalances = eligibleEmployees.map(balanceForEmployee).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const balances = isAdmin
      ? allBalances
      : allBalances.filter(employee => employee.email === email);
    const adminEmployees = isAdmin
      ? allEmployees.map(balanceForEmployee).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ko'))
      : [];
    const rewardGrantEmployees = allBalances
      .filter(employee => rewardGrantEmployeeEmails.includes(employee.email))
      .map(employee => ({ email: employee.email, name: employee.name, teamName: employee.teamName }));

    const rewardGrants = grants
      .filter(grant => visibleRewardGrantEmployeeEmails.includes(grant.employeeEmail))
      .map(grant => {
        const grantAllocations = allocations.filter(allocation => allocation.rewardGrantId === grant.id);
        const grantEmployee = allEmployees.find(employee => employee.email === grant.employeeEmail);
        const usedDays = grantAllocations.filter(allocation => allocation.status === 'USED').reduce((sum, allocation) => sum + allocation.days, 0);
        const reservedDays = grantAllocations.filter(allocation => allocation.status === 'RESERVED').reduce((sum, allocation) => sum + allocation.days, 0);
        return {
          id: grant.id,
          employeeEmail: grant.employeeEmail,
          employeeName: grantEmployee?.name ?? grant.employeeEmail,
          employeeActive: Boolean(grantEmployee?.active && grantEmployee.profileStatus === 'COMPLETE'),
          employeeStatus: grantEmployee?.employmentStatus ?? 'INACTIVE',
          grantedDays: grant.grantedDays,
          usedDays,
          reservedDays,
          remainingDays: grant.active ? Math.max(grant.grantedDays - usedDays - reservedDays, 0) : 0,
          grantedOn: grant.grantedOn,
          expiresOn: grant.expiresOn,
          memo: grant.memo,
          createdBy: grant.createdBy,
          createdAt: grant.createdAt,
          active: grant.active,
          reclaimedDays: grant.reclaimedDays,
          reclaimedAt: grant.reclaimedAt,
          reclaimedBy: grant.reclaimedBy,
          updatedAt: grant.updatedAt,
          updatedBy: grant.updatedBy,
          mutationVersion: grant.mutationVersion,
        };
      })
      .sort((a, b) => b.grantedOn.localeCompare(a.grantedOn) || b.createdAt.localeCompare(a.createdAt));

    return {
      connected: true,
      source: 'firebase',
      balances,
      adminEmployees,
      rewardGrantEmployees,
      teams,
      rewardGrants,
      requests: requests.map(request => {
        const cancellation = cancellationAccess(request, email, isAdmin);
        return {
          ...request,
          reason: request.applicantEmail === email || (viewerIsEligible && request.approverEmail === email) || isAdmin ? request.reason : '',
          canCancel: cancellation.canCancel,
          cancelBalanceWillRestore: cancellation.balanceWillRestore,
        };
      }),
      viewer: {
        email,
        registered: viewerIsEligible,
        isAdmin,
        canApprove: isAdmin || (viewerIsEligible && (requests.some(request => request.approverEmail === email) || teams.some(team => team.managerEmail === email) || viewerEmployee?.position === 'REPRESENTATIVE')),
        canGrantReward: isAdmin || managedTeamIds.length > 0,
        rewardGrantEmployeeEmails,
      },
    };
  } catch (error) {
    const connectionDiagnostic = await diagnoseFirebaseConnection(error);
    console.error('leave_dashboard_load_failed', {
      actorEmail: email,
      diagnostic: connectionDiagnostic,
      message: error instanceof globalThis.Error ? error.message : 'unknown',
    });
    await recordOperationFailure({
      actorEmail: email,
      operation: 'DASHBOARD_LOAD',
      targetType: 'DASHBOARD',
      error,
    });
    return {
      connected: false,
      source: 'firebase',
      error: connectionDiagnostic.message,
      connectionDiagnostic,
      balances: [],
      adminEmployees: [],
      rewardGrantEmployees: [],
      requests: [],
      rewardGrants: [],
      teams: [],
      viewer: { email, registered: false, isAdmin: false, canApprove: false, canGrantReward: false, rewardGrantEmployeeEmails: [] },
    };
  }
}

async function requireAdmin(actorEmail: string) {
  const email = normalizedEmail(actorEmail);
  const doc = await firestore().collection('employees').doc(email).get();
  const data = doc.data();
  if (!hasAdminAccess(email, data)) throw new Error('직원 관리 권한이 없습니다.');
}

async function requireAdminInTransaction(transaction: FirebaseFirestore.Transaction, actorEmail: string) {
  const email = normalizedEmail(actorEmail);
  const snapshot = await transaction.get(firestore().collection('employees').doc(email));
  if (!hasAdminAccess(email, snapshot.data())) throw new Error('직원 관리 권한이 없습니다.');
  return snapshot;
}

export async function upsertTeam(actorEmail: string, input: { id?: string; name: string; managerEmail: string }) {
  await requireAdmin(actorEmail);
  const db = firestore();
  const actor = normalizedEmail(actorEmail);
  const name = input.name.trim();
  const managerEmail = normalizedEmail(input.managerEmail);
  if (!name || name.length > 100) throw new Error('팀 이름을 100자 이내로 입력해 주세요.');
  if (!isConfiguredCompanyEmail(managerEmail)) throw new Error('사내 이메일을 사용하는 승인자를 지정해 주세요.');
  const id = input.id || crypto.createHash('sha1').update(input.name.trim()).digest('hex').slice(0, 12);
  const teamRef = db.collection('teams').doc(id);
  const managerRef = db.collection('employees').doc(managerEmail);
  const auditRef = db.collection('audit_logs').doc();
  await db.runTransaction(async transaction => {
    await requireAdminInTransaction(transaction, actor);
    const [teamSnapshot, managerSnapshot] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(managerRef),
    ]);
    if (!managerSnapshot.exists || !isEligibleEmployeeData(managerSnapshot.data(), managerEmail)) {
      throw new Error('등록이 완료된 활성 사내 직원만 팀 승인자로 지정할 수 있습니다.');
    }
    const manager = parseEmployee(managerSnapshot.data() ?? {});
    if (manager.position !== 'TEAM_LEAD') {
      throw new Error('팀 승인자는 직책이 팀장인 직원만 지정할 수 있습니다.');
    }
    transaction.set(teamRef, {
      name,
      managerEmail,
      active: true,
      createdAt: teamSnapshot.exists ? teamSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    }, { merge: true });
    transaction.create(auditRef, {
      actorEmail: actor,
      action: 'UPSERT_TEAM',
      targetType: 'TEAM',
      targetId: id,
      before: teamSnapshot.exists ? {
        name: String(teamSnapshot.data()?.name ?? ''),
        managerEmail: normalizedEmail(teamSnapshot.data()?.managerEmail),
      } : null,
      after: { name, managerEmail },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { id };
}

export async function upsertEmployee(actorEmail: string, input: EmployeeInput) {
  await requireAdmin(actorEmail);
  const email = normalizedEmail(input.email);
  const actor = normalizedEmail(actorEmail);
  const active = input.employmentStatus === 'ACTIVE';
  if (!isConfiguredCompanyEmail(email)) throw new Error('사내 이메일을 사용하는 직원만 등록할 수 있습니다.');
  const db = firestore();
  const employeeRef = db.collection('employees').doc(email);
  const openingRef = db.collection('leave_ledger').doc(ledgerId(`${email}:OPENING_USAGE`));
  const auditRef = db.collection('audit_logs').doc();
  const transferredTeamCount = await db.runTransaction(async transaction => {
    await requireAdminInTransaction(transaction, actor);
    const teamRef = input.teamId ? db.collection('teams').doc(input.teamId) : null;
    const [employeeSnapshot, openingSnapshot, ledgerSnapshot, teamSnapshot, employeeDirectory, applicantRequests, managedTeamsSnapshot] = await Promise.all([
      transaction.get(employeeRef),
      transaction.get(openingRef),
      transaction.get(db.collection('leave_ledger').where('employeeEmail', '==', email)),
      teamRef ? transaction.get(teamRef) : Promise.resolve(null),
      transaction.get(db.collection('employees')),
      transaction.get(db.collection('leave_requests').where('applicantEmail', '==', email)),
      transaction.get(db.collection('teams').where('managerEmail', '==', email)),
    ]);
    if (input.teamId && (!teamSnapshot?.exists || teamSnapshot.data()?.active === false)) {
      throw new Error('선택한 활성 팀을 찾을 수 없습니다.');
    }

    const wasActive = employeeSnapshot.exists && employeeSnapshot.data()?.active !== false;
    const previousPosition = (employeeSnapshot.data()?.position ?? employeeSnapshot.data()?.organizationRole ?? 'EMPLOYEE') as Position;
    const previousHireDate = String(employeeSnapshot.data()?.hireDate ?? '');
    const previousOpeningAnnualUsedDays = Math.abs(numberValue(openingSnapshot.data()?.days));
    const hasPendingApplicantRequest = applicantRequests.docs.some(doc => doc.data().status === 'PENDING');
    const futureEmployee: Employee = {
      email,
      name: input.name.trim(),
      hireDate: input.hireDate,
      teamId: input.teamId,
      teamName: teamSnapshot?.exists ? String(teamSnapshot.data()?.name ?? '') : '',
      position: input.position,
      permission: input.permission,
      slackUserId: input.slackUserId.trim(),
      active,
      employmentStatus: input.employmentStatus,
      profileStatus: 'COMPLETE',
    };
    const futureDirectory = employeeDirectory.docs
      .map(doc => parseEmployee({ ...doc.data(), email: doc.data().email || doc.id }))
      .filter(employee => employee.email !== email)
      .concat(futureEmployee);
    const activeManagedTeams = managedTeamsSnapshot.docs.filter(doc => doc.data().active !== false);
    const requiresTeamTransfer = activeManagedTeams.length > 0 && (!active || input.position !== 'TEAM_LEAD');
    const replacementManagerEmail = normalizedEmail(input.replacementManagerEmail);
    if (requiresTeamTransfer) {
      if (!replacementManagerEmail || replacementManagerEmail === email) {
        throw new Error('담당 팀을 넘겨받을 다른 팀장을 선택해 주세요.');
      }
      const replacementManager = futureDirectory.find(employee => employee.email === replacementManagerEmail);
      if (!replacementManager || !replacementManager.active || replacementManager.profileStatus !== 'COMPLETE' || replacementManager.position !== 'TEAM_LEAD') {
        throw new Error('등록이 완료된 활성 팀장에게만 담당 팀을 이관할 수 있습니다.');
      }
    }
    const futureTeams = teamSnapshot?.exists && input.teamId
      ? [{
          ...parseTeam(input.teamId, teamSnapshot.data() ?? {}),
          managerEmail: requiresTeamTransfer && normalizedEmail(teamSnapshot.data()?.managerEmail) === email
            ? replacementManagerEmail
            : normalizedEmail(teamSnapshot.data()?.managerEmail),
        }]
      : [];
    const futureActiveRepresentatives = futureDirectory.filter(employee => employee.active && employee.profileStatus === 'COMPLETE' && employee.position === 'REPRESENTATIVE');
    const futureActiveTeamLeads = futureDirectory.filter(employee => employee.active && employee.profileStatus === 'COMPLETE' && employee.position === 'TEAM_LEAD');
    if (futureActiveTeamLeads.length > 0 && futureActiveRepresentatives.length === 0) {
      throw new Error(APPROVAL_ROUTE_ERROR_MESSAGES.REPRESENTATIVE_REQUIRED);
    }
    if (futureActiveRepresentatives.length > 1) {
      throw new Error(APPROVAL_ROUTE_ERROR_MESSAGES.MULTIPLE_REPRESENTATIVES);
    }
    const routeApprover = active ? requiredApprover(futureEmployee, futureTeams, futureDirectory) : null;

    if (employeeSnapshot.exists && hasPendingApplicantRequest && previousHireDate !== input.hireDate) {
      throw new Error('승인 대기 신청이 있어 입사일을 수정할 수 없습니다. 먼저 신청을 처리해 주세요.');
    }
    if (employeeSnapshot.exists
      && Math.abs(previousOpeningAnnualUsedDays - input.openingAnnualUsedDays) > 0.0001) {
      const annualBalanceWithoutOpeningUsage = ledgerSnapshot.docs
        .map(doc => doc.data())
        .filter(entry => entry.source === 'ANNUAL' && entry.entryType !== 'OPENING_USAGE')
        .reduce((sum, entry) => sum + numberValue(entry.days), 0);
      const pendingAnnualDays = applicantRequests.docs
        .map(doc => doc.data())
        .filter(request => request.status === 'PENDING' && request.source === 'ANNUAL')
        .reduce((sum, request) => sum + numberValue(request.days), 0);
      const annualBalanceAfterUpdate = annualBalanceWithoutOpeningUsage - input.openingAnnualUsedDays;
      const availableAfterUpdate = annualBalanceAfterUpdate - pendingAnnualDays;
      if (!hasSufficientLeaveBalance(pendingAnnualDays, annualBalanceAfterUpdate)) {
        throw new Error(`기존 사용 연차를 반영하면 승인 대기분을 제외한 정기 연차가 ${normalizedAvailableDays(availableAfterUpdate)}일이 됩니다. 대기 신청을 먼저 처리하거나 기존 사용 연차를 확인해 주세요.`);
      }
    }
    const wasEffectiveAdmin = hasAdminAccess(email, employeeSnapshot.data());
    const willBeEffectiveAdmin = active && input.permission === 'ADMIN';
    if (wasEffectiveAdmin && !willBeEffectiveAdmin) {
      const otherActiveAdmins = employeeDirectory.docs.filter(doc => {
        const employeeEmail = normalizedEmail(doc.data().email || doc.id);
        return employeeEmail !== email && hasAdminAccess(employeeEmail, doc.data());
      });
      if (otherActiveAdmins.length === 0) {
        throw new Error('마지막 활성 관리자의 권한을 해제할 수 없습니다. 다른 관리자부터 지정해 주세요.');
      }
    }
    if (wasActive && !active && email === actor) {
      throw new Error('현재 로그인한 본인 계정은 비활성화할 수 없습니다.');
    }
    if (wasActive && !active) {
      const assignedRequests = await transaction.get(db.collection('leave_requests').where('approverEmail', '==', email));
      const pendingAssignedRequests = assignedRequests.docs.filter(doc => doc.data().status === 'PENDING');
      if (pendingAssignedRequests.length > 0) {
        throw new Error('담당 중인 승인 대기 신청이 있어 비활성화할 수 없습니다. 먼저 승인 또는 반려해 주세요.');
      }
      if (hasPendingApplicantRequest) {
        throw new Error('본인의 승인 대기 신청이 있어 비활성화할 수 없습니다. 먼저 신청을 취소하거나 처리해 주세요.');
      }
    }

    const employeeData: FirebaseFirestore.DocumentData = {
      email,
      name: input.name.trim(),
      hireDate: input.hireDate,
      teamId: input.teamId,
      position: input.position,
      permission: input.permission,
      slackUserId: input.slackUserId.trim(),
      active,
      employmentStatus: input.employmentStatus,
      profileStatus: 'COMPLETE',
      createdAt: employeeSnapshot.exists ? employeeSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    };
    if (employeeSnapshot.exists) {
      employeeData.jobTitle = FieldValue.delete();
      employeeData.organizationRole = FieldValue.delete();
      employeeData.isAdmin = FieldValue.delete();
      employeeData.directApproverEmail = FieldValue.delete();
    }
    transaction.set(employeeRef, employeeData, { merge: true });
    if (requiresTeamTransfer) {
      activeManagedTeams.forEach(teamDoc => {
        transaction.update(teamDoc.ref, {
          managerEmail: replacementManagerEmail,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor,
        });
        transaction.create(db.collection('audit_logs').doc(), {
          actorEmail: actor,
          action: 'TRANSFER_TEAM_MANAGER',
          targetType: 'TEAM',
          targetId: teamDoc.id,
          before: { managerEmail: email },
          after: { managerEmail: replacementManagerEmail },
          createdAt: FieldValue.serverTimestamp(),
        });
      });
    }
    if (previousHireDate && previousHireDate !== input.hireDate) {
      ledgerSnapshot.docs
        .filter(doc => String(doc.data().entryType ?? '').startsWith('AUTO_') || doc.data().entryType === 'EXPIRATION')
        .forEach(doc => transaction.delete(doc.ref));
    }
    if (input.openingAnnualUsedDays > 0) {
      transaction.set(openingRef, {
        employeeEmail: email,
        source: 'ANNUAL',
        entryType: 'OPENING_USAGE',
        days: -input.openingAnnualUsedDays,
        effectiveDate: kstToday(),
        requestId: '',
        rewardGrantId: '',
        reason: '시스템 도입 전 사용 연차',
        idempotencyKey: `OPENING_USAGE:${email}`,
        createdAt: openingSnapshot.exists ? openingSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: actor,
      }, { merge: true });
    } else if (openingSnapshot.exists) {
      transaction.delete(openingRef);
    }
    const action = wasActive && !active
      ? 'DEACTIVATE_EMPLOYEE'
      : employeeSnapshot.exists && !wasActive && active
        ? 'REACTIVATE_EMPLOYEE'
        : 'UPSERT_EMPLOYEE';
    transaction.create(auditRef, {
      actorEmail: actor,
      action,
      targetType: 'EMPLOYEE',
      targetId: email,
      before: employeeSnapshot.exists ? {
        active: wasActive,
        employmentStatus: String(employeeSnapshot.data()?.employmentStatus ?? (wasActive ? 'ACTIVE' : 'INACTIVE')),
        teamId: String(employeeSnapshot.data()?.teamId ?? ''),
        position: previousPosition,
      } : null,
      after: {
        active,
        employmentStatus: input.employmentStatus,
        teamId: input.teamId,
        position: input.position,
        approverEmail: routeApprover?.email ?? '',
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    return requiresTeamTransfer ? activeManagedTeams.length : 0;
  });
  let annualSyncWarning = false;
  if (active) {
    try {
      await syncAnnualGrants(email);
    } catch (error) {
      annualSyncWarning = true;
      await recordOperationFailure({
        actorEmail: actor,
        operation: 'SYNC_ANNUAL_GRANTS',
        targetType: 'EMPLOYEE',
        targetId: email,
        error,
      });
    }
  }
  return { email, annualSyncWarning, transferredTeamCount };
}

function validateRewardGrantFields(input: Pick<RewardGrantUpdateInput, 'grantedDays' | 'grantedOn' | 'memo'>) {
  if (!DATE_PATTERN.test(input.grantedOn) || input.grantedOn > kstToday()) throw new Error('포상 연차 지급일을 확인해 주세요.');
  if (!Number.isFinite(input.grantedDays) || input.grantedDays <= 0 || input.grantedDays > 30 || (input.grantedDays * 2) % 1 !== 0) {
    throw new Error('포상 연차는 0.5일 단위로 입력해 주세요.');
  }
  if (!input.memo.trim() || input.memo.trim().length > 200) throw new Error('포상 내용을 200자 이내로 입력해 주세요.');
}

async function requireRewardManagementAccess(
  transaction: FirebaseFirestore.Transaction,
  actor: string,
  employeeEmail: string,
  requireActiveTarget: boolean,
) {
  const db = firestore();
  const [actorSnapshot, employeeSnapshot, teamSnapshot] = await Promise.all([
    transaction.get(db.collection('employees').doc(actor)),
    transaction.get(db.collection('employees').doc(employeeEmail)),
    transaction.get(db.collection('teams')),
  ]);
  if (!employeeSnapshot.exists) {
    throw new Error('포상 연차 대상 직원을 찾을 수 없습니다.');
  }
  if (requireActiveTarget && !isEligibleEmployeeData(employeeSnapshot.data(), employeeEmail)) {
    throw new Error('포상 연차를 지급할 활성 직원을 찾을 수 없습니다.');
  }
  const actorData = actorSnapshot.data();
  const isAdmin = hasAdminAccess(actor, actorData);
  const actorIsEligible = actorSnapshot.exists && isEligibleEmployeeData(actorData, actor);
  const managedTeamIds = actorIsEligible
    ? teamSnapshot.docs
      .filter(doc => doc.data().active !== false && normalizedEmail(doc.data().managerEmail) === actor)
      .map(doc => doc.id)
    : [];
  const targetTeamId = String(employeeSnapshot.data()?.teamId ?? '');
  if (!isAdmin && !managedTeamIds.includes(targetTeamId)) {
    throw new Error('관리자 또는 해당 팀의 팀장만 포상 연차를 지급할 수 있습니다.');
  }
  if (!isAdmin && !isEligibleEmployeeData(employeeSnapshot.data(), employeeEmail)) {
    throw new Error('비활성 직원의 포상 연차는 관리자만 정정할 수 있습니다.');
  }
  return employeeSnapshot;
}

export async function grantRewardLeave(actorEmail: string, input: RewardGrantInput) {
  const db = firestore();
  const actor = normalizedEmail(actorEmail);
  const employeeEmail = normalizedEmail(input.employeeEmail);
  validateRewardGrantFields(input);
  const ref = db.collection('reward_grants').doc();
  const expiresOn = addDays(input.grantedOn, 61);
  const auditRef = db.collection('audit_logs').doc();
  await db.runTransaction(async transaction => {
    const employeeSnapshot = await requireRewardManagementAccess(transaction, actor, employeeEmail, true);
    transaction.create(ref, {
      employeeEmail,
      grantedDays: input.grantedDays,
      grantedOn: input.grantedOn,
      expiresOn,
      memo: input.memo.trim(),
      active: true,
      reclaimedDays: 0,
      mutationVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    });
    transaction.update(employeeSnapshot.ref, {
      leaveMutationVersion: FieldValue.increment(1),
      leaveMutationAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      actorEmail: actor,
      action: 'GRANT_REWARD_LEAVE',
      targetType: 'REWARD_GRANT',
      targetId: ref.id,
      employeeEmail,
      after: {
        grantedDays: input.grantedDays,
        grantedOn: input.grantedOn,
        expiresOn,
        memo: input.memo.trim(),
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { id: ref.id, expiresOn };
}

export async function updateRewardGrant(actorEmail: string, grantId: string, input: RewardGrantUpdateInput) {
  validateRewardGrantFields(input);
  const db = firestore();
  const actor = normalizedEmail(actorEmail);
  const grantRef = db.collection('reward_grants').doc(grantId);
  const auditRef = db.collection('audit_logs').doc();
  const expiresOn = addDays(input.grantedOn, 61);
  await db.runTransaction(async transaction => {
    const grantSnapshot = await transaction.get(grantRef);
    if (!grantSnapshot.exists) throw new Error('포상 연차 지급 내역을 찾을 수 없습니다.');
    const grant = parseRewardGrant(grantSnapshot.id, grantSnapshot.data() ?? {});
    if (!grant.active) throw new Error('이미 전액 회수된 포상 연차는 수정할 수 없습니다.');
    if (grant.mutationVersion !== input.expectedMutationVersion) {
      throw new Error('다른 관리자가 이 지급 건을 먼저 변경했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
    }
    const employeeSnapshot = await requireRewardManagementAccess(transaction, actor, grant.employeeEmail, false);
    const targetIsActive = isEligibleEmployeeData(employeeSnapshot.data(), grant.employeeEmail);
    if (!targetIsActive && (input.grantedDays - grant.grantedDays > 0.0001 || input.grantedOn !== grant.grantedOn)) {
      throw new Error('비활성 직원의 포상 연차는 증액하거나 사용 기한을 변경할 수 없습니다.');
    }
    const allocationSnapshot = await transaction.get(db.collection('reward_allocations').where('rewardGrantId', '==', grantId));
    const allocations = allocationSnapshot.docs.map(doc => parseAllocation(doc.data()));
    const validationError = validateRewardGrantAdjustment({
      grantedDays: input.grantedDays,
      grantedOn: input.grantedOn,
      expiresOn,
      allocations,
    });
    if (validationError) throw new Error(validationError);
    transaction.update(grantRef, {
      grantedDays: input.grantedDays,
      grantedOn: input.grantedOn,
      expiresOn,
      memo: input.memo.trim(),
      mutationVersion: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    });
    transaction.update(employeeSnapshot.ref, {
      leaveMutationVersion: FieldValue.increment(1),
      leaveMutationAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      actorEmail: actor,
      action: 'UPDATE_REWARD_LEAVE',
      targetType: 'REWARD_GRANT',
      targetId: grantId,
      employeeEmail: grant.employeeEmail,
      before: {
        grantedDays: grant.grantedDays,
        grantedOn: grant.grantedOn,
        expiresOn: grant.expiresOn,
        memo: grant.memo,
      },
      after: {
        grantedDays: input.grantedDays,
        grantedOn: input.grantedOn,
        expiresOn,
        memo: input.memo.trim(),
        mutationVersion: grant.mutationVersion + 1,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { id: grantId, expiresOn };
}

export async function reclaimRewardGrant(actorEmail: string, grantId: string, expectedMutationVersion: number) {
  const db = firestore();
  const actor = normalizedEmail(actorEmail);
  const grantRef = db.collection('reward_grants').doc(grantId);
  const auditRef = db.collection('audit_logs').doc();
  return db.runTransaction(async transaction => {
    const grantSnapshot = await transaction.get(grantRef);
    if (!grantSnapshot.exists) throw new Error('포상 연차 지급 내역을 찾을 수 없습니다.');
    const grant = parseRewardGrant(grantSnapshot.id, grantSnapshot.data() ?? {});
    if (!grant.active) throw new Error('이미 전액 회수된 포상 연차입니다.');
    if (grant.mutationVersion !== expectedMutationVersion) {
      throw new Error('다른 관리자가 이 지급 건을 먼저 변경했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
    }
    if (grant.expiresOn < kstToday()) throw new Error('이미 만료된 포상 연차는 별도로 회수할 필요가 없습니다.');
    const employeeSnapshot = await requireRewardManagementAccess(transaction, actor, grant.employeeEmail, false);
    const allocationSnapshot = await transaction.get(db.collection('reward_allocations').where('rewardGrantId', '==', grantId));
    const reclaim = calculateRewardReclaim(
      grant.grantedDays,
      allocationSnapshot.docs.map(doc => parseAllocation(doc.data())),
    );
    const { protectedDays, reclaimedDays, active } = reclaim;
    if (reclaimedDays <= 0.0001) throw new Error('현재 회수할 수 있는 포상 연차 잔여분이 없습니다.');
    transaction.update(grantRef, {
      grantedDays: protectedDays,
      active,
      reclaimedDays: FieldValue.increment(reclaimedDays),
      reclaimedAt: FieldValue.serverTimestamp(),
      reclaimedBy: actor,
      mutationVersion: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    });
    transaction.update(employeeSnapshot.ref, {
      leaveMutationVersion: FieldValue.increment(1),
      leaveMutationAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      actorEmail: actor,
      action: 'RECLAIM_REWARD_LEAVE',
      targetType: 'REWARD_GRANT',
      targetId: grantId,
      employeeEmail: grant.employeeEmail,
      before: { grantedDays: grant.grantedDays, active: grant.active },
      after: { grantedDays: protectedDays, active, reclaimedDays, mutationVersion: grant.mutationVersion + 1 },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id: grantId, reclaimedDays, active };
  });
}

function allocationPlan(grants: RewardGrant[], allocations: RewardAllocation[], dates: string[], amountPerDate: number) {
  const usedByGrant = new Map<string, number>();
  allocations.filter(item => item.status === 'RESERVED' || item.status === 'USED').forEach(item => usedByGrant.set(item.rewardGrantId, (usedByGrant.get(item.rewardGrantId) ?? 0) + item.days));
  const remainingByGrant = new Map(grants.map(grant => [grant.id, grant.grantedDays - (usedByGrant.get(grant.id) ?? 0)]));
  const plan: { grantId: string; usageDate: string; days: number }[] = [];
  for (const usageDate of dates) {
    let needed = amountPerDate;
    const candidates = grants.filter(grant => grant.active && grant.grantedOn <= usageDate && grant.expiresOn >= usageDate).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
    for (const grant of candidates) {
      const available = remainingByGrant.get(grant.id) ?? 0;
      const take = Math.min(available, needed);
      if (take > 0) {
        plan.push({ grantId: grant.id, usageDate, days: take });
        remainingByGrant.set(grant.id, available - take);
        needed -= take;
      }
      if (needed <= 0) break;
    }
    if (needed > 0) throw new Error(`${usageDate}에 사용할 수 있는 포상휴가가 부족하거나 유효기간이 지났습니다.`);
  }
  return plan;
}

function integrationRequestFromData(
  requestId: string,
  data: FirebaseFirestore.DocumentData,
): LeaveIntegrationRequest {
  const request = parseRequest(requestId, data);
  return {
    requestId,
    applicantEmail: request.applicantEmail,
    applicantName: request.applicantName,
    approverEmail: request.approverEmail,
    approverSlackUserId: String(data.approverSlackUserId ?? ''),
    source: request.source,
    duration: request.duration,
    startDate: request.startDate,
    endDate: request.endDate,
    days: request.days,
    reason: request.reason,
    slackChannelId: String(data.slackChannelId ?? ''),
    slackMessageTs: String(data.slackMessageTs ?? ''),
  };
}

export async function createLeaveRequest(actor: { email: string; name: string }, input: NewLeaveRequestInput) {
  const db = firestore();
  const email = normalizedEmail(actor.email);
  const employeeRef = db.collection('employees').doc(email);
  const employeeDoc = await employeeRef.get();
  if (!employeeDoc.exists || employeeDoc.data()?.active === false || employeeDoc.data()?.profileStatus !== 'COMPLETE') throw new Error('등록이 완료된 활성 직원만 신청할 수 있습니다.');
  await syncAnnualGrants(email);
  const dates = workDates(input);
  const days = input.duration === 'FULL_DAY' ? dates.length : 0.5;
  const ref = db.collection('leave_requests').doc();
  const auditRef = db.collection('audit_logs').doc(ledgerId(`CREATE_REQUEST:${ref.id}`));
  let autoApproved = false;
  let integrationRequest: LeaveIntegrationRequest | null = null;

  await db.runTransaction(async transaction => {
    const [applicantSnapshot, employeeDirectory] = await Promise.all([
      transaction.get(employeeRef),
      transaction.get(db.collection('employees')),
    ]);
    if (!applicantSnapshot.exists || !isEligibleEmployeeData(applicantSnapshot.data(), email)) {
      throw new Error('등록이 완료된 활성 직원만 신청할 수 있습니다.');
    }
    const currentEmployee = parseEmployee(applicantSnapshot.data() ?? {});
    const teamSnapshot = currentEmployee.teamId
      ? await transaction.get(db.collection('teams').doc(currentEmployee.teamId))
      : null;
    if (currentEmployee.teamId && (!teamSnapshot?.exists || teamSnapshot.data()?.active === false)) {
      throw new Error('활성 소속 팀을 찾을 수 없습니다. 직원 관리에서 소속을 확인해 주세요.');
    }
    const allEmployees = employeeDirectory.docs.map(doc => parseEmployee({ ...doc.data(), email: doc.data().email || doc.id }));
    const routeTeams = teamSnapshot?.exists && currentEmployee.teamId
      ? [parseTeam(currentEmployee.teamId, teamSnapshot.data() ?? {})]
      : [];
    const approver = requiredApprover(currentEmployee, routeTeams, allEmployees);
    const approverEmail = approver.email;
    const approverSnapshot = approverEmail === email
      ? applicantSnapshot
      : employeeDirectory.docs.find(doc => normalizedEmail(doc.data().email || doc.id) === approverEmail);
    if (!approverSnapshot?.exists || !isEligibleEmployeeData(approverSnapshot.data(), approverEmail)) {
      throw new Error('등록이 완료된 활성 사내 승인자를 찾을 수 없습니다. 직원 관리에서 승인 경로를 확인해 주세요.');
    }
    autoApproved = currentEmployee.position === 'REPRESENTATIVE';
    const approverName = autoApproved
      ? currentEmployee.name
      : approver.name || String(approverSnapshot.data()?.name ?? approverEmail);

    const existingSnapshot = await transaction.get(db.collection('leave_requests').where('applicantEmail', '==', email));
    const existing = existingSnapshot.docs.map(doc => parseRequest(doc.id, doc.data()));
    if (existing.some(request => isRequestConflict(request, input.duration, dates))) throw new Error('같은 날짜와 시간대에 이미 승인 또는 대기 중인 신청이 있습니다.');

    let rewardPlan: ReturnType<typeof allocationPlan> = [];
    if (input.source === 'ANNUAL') {
      const ledgerSnapshot = await transaction.get(db.collection('leave_ledger').where('employeeEmail', '==', email));
      const annualBalance = ledgerSnapshot.docs.filter(doc => doc.data().source === 'ANNUAL').reduce((sum, doc) => sum + numberValue(doc.data().days), 0);
      const pendingDays = existing.filter(request => request.source === 'ANNUAL' && request.status === 'PENDING').reduce((sum, request) => sum + request.days, 0);
      const availableDays = annualBalance - pendingDays;
      if (!hasSufficientLeaveBalance(days, availableDays)) throw new Error(`신청 가능한 정기 연차는 ${normalizedAvailableDays(availableDays)}일입니다.`);
    } else {
      const [grantSnapshot, allocationSnapshot] = await Promise.all([
        transaction.get(db.collection('reward_grants').where('employeeEmail', '==', email)),
        transaction.get(db.collection('reward_allocations').where('employeeEmail', '==', email)),
      ]);
      const grants = grantSnapshot.docs.map(doc => parseRewardGrant(doc.id, doc.data()));
      const allocations = allocationSnapshot.docs.map(doc => parseAllocation(doc.data()));
      rewardPlan = allocationPlan(grants, allocations, dates, input.duration === 'FULL_DAY' ? 1 : 0.5);
    }

    const requestData = {
      applicantEmail: email,
      applicantName: currentEmployee.name || actor.name,
      approverEmail,
      approverName,
      approverSlackUserId: String(approverSnapshot.data()?.slackUserId ?? ''),
      source: input.source,
      duration: input.duration,
      startDate: input.startDate,
      endDate: input.duration === 'FULL_DAY' ? input.endDate : input.startDate,
      workDates: dates,
      days,
      reason: input.reason.trim(),
      status: autoApproved ? 'APPROVED' : 'PENDING',
      createdAt: FieldValue.serverTimestamp(),
      decidedAt: autoApproved ? FieldValue.serverTimestamp() : null,
      cancelledAt: null,
    };
    transaction.create(ref, requestData);
    integrationRequest = {
      requestId: ref.id,
      applicantEmail: email,
      applicantName: currentEmployee.name || actor.name,
      approverEmail,
      approverSlackUserId: String(approverSnapshot.data()?.slackUserId ?? ''),
      source: input.source,
      duration: input.duration,
      startDate: input.startDate,
      endDate: input.duration === 'FULL_DAY' ? input.endDate : input.startDate,
      days,
      reason: input.reason.trim(),
    };

    if (input.source === 'ANNUAL' && autoApproved) {
      transaction.create(db.collection('leave_ledger').doc(ledgerId(`USE:${ref.id}`)), {
        employeeEmail: email, source: 'ANNUAL', entryType: 'USE', days: -days, effectiveDate: firstLeaveUsageDate(dates, input.startDate),
        requestId: ref.id, rewardGrantId: '', reason: input.reason.trim(), idempotencyKey: `USE:${ref.id}`,
        createdAt: FieldValue.serverTimestamp(), createdBy: email,
      });
    }
    rewardPlan.forEach((allocation, index) => {
      transaction.create(db.collection('reward_allocations').doc(ledgerId(`${ref.id}:${index}`)), {
        requestId: ref.id,
        employeeEmail: email,
        usageDate: allocation.usageDate,
        rewardGrantId: allocation.grantId,
        days: allocation.days,
        status: autoApproved ? 'USED' : 'RESERVED',
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    transaction.update(employeeRef, {
      leaveMutationVersion: FieldValue.increment(1),
      leaveMutationAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      requestId: ref.id,
      actorEmail: email,
      action: autoApproved ? 'AUTO_APPROVE_REPRESENTATIVE' : 'CREATE_REQUEST',
      targetType: 'LEAVE_REQUEST',
      targetId: ref.id,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  const completedIntegrationRequest = integrationRequest as LeaveIntegrationRequest | null;
  if (!completedIntegrationRequest) throw new Error('연차 신청 연동 정보를 만들지 못했습니다.');
  return { requestId: ref.id, autoApproved, integrationRequest: completedIntegrationRequest };
}

export async function decideLeaveRequest(requestId: string, actorEmail: string, action: 'approve' | 'reject') {
  const db = firestore();
  const email = normalizedEmail(actorEmail);
  const ref = db.collection('leave_requests').doc(requestId);
  const actorRef = db.collection('employees').doc(email);
  const auditRef = db.collection('audit_logs').doc(ledgerId(`DECIDE_REQUEST:${requestId}`));
  let integrationRequest: LeaveIntegrationRequest | null = null;
  await db.runTransaction(async transaction => {
    const [requestDoc, actorDoc] = await Promise.all([
      transaction.get(ref),
      transaction.get(actorRef),
    ]);
    if (!requestDoc.exists) throw new Error('신청 내역을 찾을 수 없습니다.');
    const current = parseRequest(requestDoc.id, requestDoc.data() ?? {});
    if (current.status !== 'PENDING') throw new Error('이미 처리된 신청입니다.');
    if (current.approverEmail !== email) throw new Error('이 신청의 담당 승인자가 아닙니다.');
    if (!actorDoc.exists || !isEligibleEmployeeData(actorDoc.data(), email)) {
      throw new Error('등록이 완료된 활성 사내 승인자만 처리할 수 있습니다.');
    }
    const applicantRef = db.collection('employees').doc(current.applicantEmail);
    const applicantDoc = current.applicantEmail === email
      ? actorDoc
      : await transaction.get(applicantRef);
    if (action === 'approve' && (!applicantDoc.exists || !isEligibleEmployeeData(applicantDoc.data(), current.applicantEmail))) {
      throw new Error('비활성 직원의 신청은 승인할 수 없습니다. 신청을 반려해 주세요.');
    }
    if (action === 'approve'
      && current.applicantEmail === email
      && applicantDoc.data()?.position !== 'REPRESENTATIVE'
      && applicantDoc.data()?.organizationRole !== 'REPRESENTATIVE'
      && !allowLocalSelfApproval()) {
      throw new Error('대표가 아닌 직원은 본인의 신청을 직접 승인할 수 없습니다.');
    }

    const allocationSnapshot = current.source === 'REWARD'
      ? await transaction.get(db.collection('reward_allocations').where('requestId', '==', requestId))
      : null;
    if (current.source === 'ANNUAL' && action === 'approve') {
      const [ledgerSnapshot, pendingSnapshot] = await Promise.all([
        transaction.get(db.collection('leave_ledger').where('employeeEmail', '==', current.applicantEmail)),
        transaction.get(db.collection('leave_requests').where('applicantEmail', '==', current.applicantEmail)),
      ]);
      const annualBalance = ledgerSnapshot.docs
        .filter(doc => doc.data().source === 'ANNUAL')
        .reduce((sum, doc) => sum + numberValue(doc.data().days), 0);
      const pendingDays = pendingSnapshot.docs
        .map(doc => parseRequest(doc.id, doc.data()))
        .filter(request => request.source === 'ANNUAL' && request.status === 'PENDING')
        .reduce((sum, request) => sum + request.days, 0);
      if (!hasSufficientLeaveBalance(pendingDays, annualBalance)) {
        throw new Error('현재 정기 연차 잔액이 승인 대기 예약보다 부족하여 승인할 수 없습니다.');
      }
    }

    if (current.source === 'ANNUAL' && action === 'approve') {
      transaction.create(db.collection('leave_ledger').doc(ledgerId(`USE:${requestId}`)), {
        employeeEmail: current.applicantEmail, source: 'ANNUAL', entryType: 'USE', days: -current.days, effectiveDate: firstLeaveUsageDate(current.workDates, current.startDate),
        requestId, rewardGrantId: '', reason: current.reason, idempotencyKey: `USE:${requestId}`,
        createdAt: FieldValue.serverTimestamp(), createdBy: email,
      });
    }
    if (current.source === 'REWARD') {
      const allocationDocs = allocationSnapshot?.docs ?? [];
      const allocatedDays = allocationDocs.reduce((sum, allocation) => sum + numberValue(allocation.data().days), 0);
      if (allocationDocs.length === 0 || Math.abs(allocatedDays - current.days) > 0.0001 || allocationDocs.some(allocation => allocation.data().status !== 'RESERVED')) {
        throw new Error('포상휴가 예약 데이터가 신청 내역과 일치하지 않습니다.');
      }
      allocationDocs.forEach(allocation => transaction.update(allocation.ref, { status: action === 'approve' ? 'USED' : 'CANCELLED', updatedAt: FieldValue.serverTimestamp() }));
    }
    transaction.update(ref, { status: action === 'approve' ? 'APPROVED' : 'REJECTED', decidedAt: FieldValue.serverTimestamp(), decidedBy: email });
    transaction.update(applicantRef, {
      leaveMutationVersion: FieldValue.increment(1),
      leaveMutationAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      requestId,
      actorEmail: email,
      action: action === 'approve' ? 'APPROVE_REQUEST' : 'REJECT_REQUEST',
      targetType: 'LEAVE_REQUEST',
      targetId: requestId,
      before: { status: 'PENDING' },
      after: { status: action === 'approve' ? 'APPROVED' : 'REJECTED' },
      createdAt: FieldValue.serverTimestamp(),
    });
    integrationRequest = {
      ...integrationRequestFromData(requestId, requestDoc.data() ?? {}),
    };
  });
  const completedIntegrationRequest = integrationRequest as LeaveIntegrationRequest | null;
  if (!completedIntegrationRequest) throw new Error('연차 승인 연동 정보를 만들지 못했습니다.');
  return {
    status: action === 'approve' ? 'APPROVED' : 'REJECTED',
    integrationRequest: completedIntegrationRequest,
  };
}

export async function employeeEmailForSlackUser(slackUserId: string) {
  const normalizedSlackUserId = slackUserId.trim();
  if (!normalizedSlackUserId) throw new Error('Slack 사용자 ID를 확인할 수 없습니다.');
  const snapshot = await firestore()
    .collection('employees')
    .where('slackUserId', '==', normalizedSlackUserId)
    .limit(2)
    .get();
  if (snapshot.size !== 1) {
    throw new Error(snapshot.empty
      ? 'Slack 사용자 ID와 연결된 직원을 찾을 수 없습니다.'
      : '동일한 Slack 사용자 ID가 여러 직원에게 등록되어 있습니다.');
  }
  const employee = parseEmployee({
    ...snapshot.docs[0].data(),
    email: snapshot.docs[0].data().email || snapshot.docs[0].id,
  });
  if (!employee.active || employee.profileStatus !== 'COMPLETE') {
    throw new Error('등록이 완료된 활성 사내 승인자만 처리할 수 있습니다.');
  }
  return employee.email;
}

export async function saveLeaveRequestSlackReference(
  requestId: string,
  input: { channelId: string; messageTs: string },
) {
  await firestore().collection('leave_requests').doc(requestId).update({
    slackChannelId: input.channelId,
    slackMessageTs: input.messageTs,
    slackSentAt: FieldValue.serverTimestamp(),
  });
}

export async function cancelLeaveRequest(requestId: string, actorEmail: string) {
  const db = firestore();
  const email = normalizedEmail(actorEmail);
  const requestRef = db.collection('leave_requests').doc(requestId);
  const actorRef = db.collection('employees').doc(email);

  return db.runTransaction(async transaction => {
    const [requestDoc, actorDoc] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(actorRef),
    ]);
    if (!requestDoc.exists) throw new Error('신청 내역을 찾을 수 없습니다.');

    const requestData = requestDoc.data() ?? {};
    const current = parseRequest(requestDoc.id, requestData);
    const actorData = actorDoc.data();
    const isAdmin = hasAdminAccess(email, actorData);
    if (current.applicantEmail !== email && !isAdmin) throw new Error('이 신청을 취소할 권한이 없습니다.');

    if (current.status === 'CANCELLED') {
      return {
        status: 'CANCELLED' as const,
        balanceRestored: requestData.cancellationBalanceRestored === true,
        alreadyCancelled: true,
      };
    }
    if (current.status === 'REJECTED') throw new Error('반려된 신청은 취소할 수 없습니다.');
    if (current.status !== 'PENDING' && current.status !== 'APPROVED') throw new Error('현재 상태에서는 신청을 취소할 수 없습니다.');
    const applicantRef = db.collection('employees').doc(current.applicantEmail);
    const applicantDoc = current.applicantEmail === email
      ? actorDoc
      : await transaction.get(applicantRef);

    const firstUsageDate = firstLeaveUsageDate(current.workDates, current.startDate);
    const cancellation = resolveCancellationPolicy({
      status: current.status,
      isApplicant: current.applicantEmail === email,
      isAdmin,
      firstUsageDate,
      today: kstToday(),
    });
    if (!cancellation.canCancel && current.status === 'APPROVED') {
      throw new Error('시작일 당일 이후의 승인 신청은 관리자만 취소할 수 있습니다.');
    }

    const balanceWillRestore = cancellation.balanceWillRestore;
    const useRef = db.collection('leave_ledger').doc(ledgerId(`USE:${requestId}`));
    const useDoc = current.source === 'ANNUAL' ? await transaction.get(useRef) : null;
    const allocationSnapshot = current.source === 'REWARD'
      ? await transaction.get(db.collection('reward_allocations').where('requestId', '==', requestId))
      : null;
    let annualUseEffectiveDate = '';

    if (current.source === 'ANNUAL') {
      if (current.status === 'PENDING' && useDoc?.exists) {
        throw new Error('연차 원장 데이터가 신청 상태와 일치하지 않아 취소할 수 없습니다.');
      }
      if (current.status === 'APPROVED') {
        const useData = useDoc?.data();
        const useEffectiveDate = String(useData?.effectiveDate ?? '');
        const validUse = useDoc?.exists
          && useData?.entryType === 'USE'
          && useData?.source === 'ANNUAL'
          && normalizedEmail(useData?.employeeEmail) === current.applicantEmail
          && String(useData?.requestId ?? '') === requestId
          && DATE_PATTERN.test(useEffectiveDate)
          && (useEffectiveDate === firstUsageDate || useEffectiveDate === current.startDate)
          && Math.abs(numberValue(useData?.days) + current.days) < 0.0001;
        if (!validUse) throw new Error('연차 원장 데이터가 신청 상태와 일치하지 않아 취소할 수 없습니다.');
        annualUseEffectiveDate = useEffectiveDate;
      }
    } else {
      const allocationDocs = allocationSnapshot?.docs ?? [];
      const expectedStatus = current.status === 'PENDING' ? 'RESERVED' : 'USED';
      const allocatedDays = allocationDocs.reduce((sum, doc) => sum + numberValue(doc.data().days), 0);
      const validAllocations = allocationDocs.length > 0
        && Math.abs(allocatedDays - current.days) < 0.0001
        && allocationDocs.every(doc => {
          const data = doc.data();
          return normalizedEmail(data.employeeEmail) === current.applicantEmail
            && String(data.requestId ?? '') === requestId
            && data.status === expectedStatus;
        });
      if (!validAllocations) throw new Error('포상휴가 배정 데이터가 신청 상태와 일치하지 않아 취소할 수 없습니다.');
    }

    if (current.source === 'ANNUAL' && current.status === 'APPROVED' && balanceWillRestore) {
      transaction.create(db.collection('leave_ledger').doc(ledgerId(`RESTORE:${requestId}`)), {
        employeeEmail: current.applicantEmail,
        source: 'ANNUAL',
        entryType: 'RESTORE',
        days: current.days,
        effectiveDate: annualUseEffectiveDate,
        requestId,
        rewardGrantId: '',
        reason: '승인된 연차 신청 취소 복원',
        idempotencyKey: `RESTORE:${requestId}`,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: email,
      });
    }

    if (current.source === 'REWARD' && balanceWillRestore) {
      allocationSnapshot?.docs.forEach(allocation => transaction.update(allocation.ref, {
        status: 'CANCELLED',
        updatedAt: FieldValue.serverTimestamp(),
      }));
    }

    transaction.update(requestRef, {
      status: 'CANCELLED',
      cancelledFromStatus: current.status,
      cancellationBalanceRestored: balanceWillRestore,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: email,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (applicantDoc.exists) {
      transaction.update(applicantRef, {
        leaveMutationVersion: FieldValue.increment(1),
        leaveMutationAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.create(db.collection('audit_logs').doc(ledgerId(`CANCEL_REQUEST:${requestId}`)), {
      requestId,
      actorEmail: email,
      action: current.status === 'PENDING' ? 'CANCEL_PENDING_REQUEST' : 'CANCEL_APPROVED_REQUEST',
      targetType: 'LEAVE_REQUEST',
      targetId: requestId,
      before: { status: current.status },
      after: { status: 'CANCELLED', balanceRestored: balanceWillRestore },
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      status: 'CANCELLED' as const,
      balanceRestored: balanceWillRestore,
      alreadyCancelled: false,
      cancelledFromStatus: current.status,
      integrationRequest: integrationRequestFromData(requestId, requestData),
    };
  });
}

const HISTORY_ACTIONS = new Set<OperationHistoryItem['action']>([
  'APPROVE_REQUEST',
  'REJECT_REQUEST',
  'CANCEL_PENDING_REQUEST',
  'CANCEL_APPROVED_REQUEST',
  'AUTO_APPROVE_REPRESENTATIVE',
]);

export async function fetchAdminOperationRecords(
  actorEmail: string,
  requests: LeaveRequest[],
): Promise<AdminOperationRecords> {
  if (isDemoMode()) return { history: [], failures: [] };
  await requireAdmin(actorEmail);
  const db = firestore();
  const [auditSnapshot, failureSnapshot] = await Promise.all([
    db.collection('audit_logs').orderBy('createdAt', 'desc').limit(200).get(),
    db.collection('operation_logs').orderBy('createdAt', 'desc').limit(200).get(),
  ]);
  const requestById = new Map(requests.map(request => [request.requestId, request]));
  const history = auditSnapshot.docs.flatMap(doc => {
    const data = doc.data();
    const action = String(data.action ?? '') as OperationHistoryItem['action'];
    if (!HISTORY_ACTIONS.has(action)) return [];
    const requestId = String(data.requestId ?? data.targetId ?? '');
    const request = requestById.get(requestId);
    return [{
      id: doc.id,
      action,
      actorEmail: normalizedEmail(data.actorEmail),
      requestId,
      applicantEmail: request?.applicantEmail ?? '',
      applicantName: request?.applicantName ?? '',
      startDate: request?.startDate ?? '',
      endDate: request?.endDate ?? '',
      source: request?.source ?? 'ANNUAL',
      days: request?.days ?? 0,
      balanceRestored: data.after?.balanceRestored === true,
      createdAt: dateValue(data.createdAt),
    }];
  });
  const failures = failureSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      correlationId: String(data.correlationId ?? ''),
      operation: String(data.operation ?? ''),
      actorEmail: normalizedEmail(data.actorEmail),
      targetType: String(data.targetType ?? ''),
      targetId: String(data.targetId ?? ''),
      message: String(data.message ?? ''),
      createdAt: dateValue(data.createdAt),
      resolvedAt: dateValue(data.resolvedAt),
      resolvedBy: normalizedEmail(data.resolvedBy),
    };
  });
  return { history, failures };
}

export async function recordOperationFailure(input: {
  actorEmail: string;
  operation: string;
  targetType?: string;
  targetId?: string;
  error: unknown;
  correlationId?: string;
  technicalMessage?: string;
}) {
  const message = input.technicalMessage
    || (input.error instanceof globalThis.Error ? input.error.message : '알 수 없는 처리 오류');
  try {
    await firestore().collection('operation_logs').add({
      outcome: 'FAILURE',
      correlationId: String(input.correlationId ?? '').slice(0, 80),
      operation: input.operation.slice(0, 80),
      actorEmail: normalizedEmail(input.actorEmail),
      targetType: String(input.targetType ?? '').slice(0, 80),
      targetId: String(input.targetId ?? '').slice(0, 200),
      message: message.slice(0, 500),
      resolvedAt: null,
      resolvedBy: '',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (loggingError) {
    const loggingDiagnostic = adminErrorDiagnostic(loggingError);
    console.error('operation_failure_log_write_failed', {
      operation: input.operation,
      correlationId: input.correlationId,
      actorEmail: normalizedEmail(input.actorEmail),
      message,
      loggingCode: loggingDiagnostic.code,
      loggingMessage: loggingDiagnostic.message,
    });
  }
}

export async function resolveOperationFailure(actorEmail: string, logId: string) {
  await requireAdmin(actorEmail);
  const db = firestore();
  const actor = normalizedEmail(actorEmail);
  const logRef = db.collection('operation_logs').doc(logId);
  const auditRef = db.collection('audit_logs').doc();
  return db.runTransaction(async transaction => {
    await requireAdminInTransaction(transaction, actor);
    const logSnapshot = await transaction.get(logRef);
    if (!logSnapshot.exists) throw new Error('실패 로그를 찾을 수 없습니다.');
    if (logSnapshot.data()?.resolvedAt) return { alreadyResolved: true };
    transaction.update(logRef, {
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: actor,
    });
    transaction.create(auditRef, {
      actorEmail: actor,
      action: 'RESOLVE_OPERATION_FAILURE',
      targetType: 'OPERATION_LOG',
      targetId: logId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { alreadyResolved: false };
  });
}
