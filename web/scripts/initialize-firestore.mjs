import dotenv from 'dotenv';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: '.env.local' });

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const adminEmails = (process.env.FIREBASE_ADMIN_EMAILS ?? '')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

if (!projectId) throw new Error('FIREBASE_PROJECT_ID가 필요합니다.');
if (adminEmails.length === 0) throw new Error('FIREBASE_ADMIN_EMAILS에 최초 관리자 이메일을 입력해 주세요.');

const app = getApps()[0] ?? initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);

const POLICY_ID = '2026-07-20-v6';
const SCHEMA_ID = 'v5';

const leavePolicy = {
  version: 6,
  name: 'SafeAI 연차 정책',
  active: true,
  timezone: 'Asia/Seoul',
  annualLeave: {
    source: 'ANNUAL',
    assumeFullAttendance: true,
    underOneYear: {
      grantTrigger: 'MONTHLY_HIRE_DATE_ANNIVERSARY',
      daysPerCompletedMonth: 1,
      maximumDays: 11,
    },
    firstAnniversary: {
      grantTrigger: 'FIRST_HIRE_ANNIVERSARY',
      numeratorPeriod: 'HIRE_DATE_THROUGH_HIRE_YEAR_DECEMBER_31_INCLUSIVE',
      denominator: 'DAYS_IN_HIRE_YEAR',
      baseDays: 15,
      roundingUnitDays: 0.5,
      roundingMode: 'CEIL',
    },
    seniority: {
      grantTrigger: 'JANUARY_1',
      startingCalendarYearDifference: 2,
      baseDays: 15,
      additionalDaysPerCalendarYear: 1,
      maximumDays: 25,
    },
    unusedBalance: {
      monthlyGrantPeriod: 'ACCUMULATE_UNTIL_FIRST_ANNUAL_GRANT',
      firstAnnualGrant: 'EXPIRE_PREVIOUS_UNUSED_BALANCE_BEFORE_GRANT',
      januaryFirstGrant: 'EXPIRE_PREVIOUS_UNUSED_BALANCE_BEFORE_GRANT',
      carryOver: false,
    },
  },
  rewardLeave: {
    source: 'REWARD',
    managedPerGrant: true,
    grantPermission: 'TEAM_MANAGER_OR_ADMIN',
    teamManagerGrantScope: 'OWN_TEAM_ONLY',
    adminGrantScope: 'ALL_ACTIVE_EMPLOYEES',
    expiryOffsetDays: 61,
    expiryDateInclusive: true,
    allowHalfDay: true,
    allocationOrder: 'EARLIEST_EXPIRY_FIRST_VALID_ON_USAGE_DATE',
    validateAgainstUsageDate: true,
    reserveWhilePending: true,
    fallbackToAnnual: false,
    correction: {
      allowEdit: true,
      minimumDays: 'USED_PLUS_RESERVED',
      reclaimScope: 'UNUSED_REMAINING_ONLY',
      preserveUsedAndReservedAllocations: true,
    },
    example: { grantedOn: '2026-08-01', usableThrough: '2026-10-01' },
  },
  requests: {
    allowedSources: ['ANNUAL', 'REWARD'],
    allowedDurations: ['FULL_DAY', 'AM_HALF', 'PM_HALF'],
    halfDayAmount: 0.5,
    allowMultipleWorkdaysInOneRequest: true,
    nonContiguousDatesRequireSeparateRequests: true,
    excludeWeekends: true,
    excludePublicHolidays: false,
    excludeCompanyHolidays: false,
    allowAmAndPmHalfOnSameDate: true,
    disallowDuplicateSameHalfOnSameDate: true,
    disallowFullDayAndHalfDayOverlap: true,
    reserveBalanceWhilePending: true,
    reasonVisibility: ['APPLICANT', 'ASSIGNED_APPROVER', 'ADMIN'],
  },
  approval: {
    defaultRoute: 'POSITION_AND_TEAM',
    routes: {
      employee: 'TEAM_MANAGER',
      teamLead: 'REPRESENTATIVE',
      representative: 'AUTO_APPROVAL',
    },
    employeeOverrideAllowed: false,
    requireTeamManagerPosition: 'TEAM_LEAD',
    requireSingleActiveRepresentative: true,
    approverEligibility: 'ACTIVE_COMPLETE_COMPANY_EMPLOYEE',
    blockDeactivationWhileAssigned: true,
    representativeAutoApproval: true,
    snapshotApproverOnRequest: true,
    statuses: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  },
  cancellation: {
    scope: 'WHOLE_REQUEST_ONLY',
    pending: 'IMMEDIATE',
    approvedBeforeStart: 'IMMEDIATE_AND_RESTORE_BALANCE',
    onOrAfterStart: 'ADMIN_ONLY_NO_AUTOMATIC_RESTORE',
    updateSlackMessage: true,
  },
  employees: {
    statuses: ['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'INACTIVE'],
    inactiveCanRequest: false,
    inactiveCanApprove: false,
    inactiveCanReceiveReward: false,
    preserveHistoryOnDeactivation: true,
  },
  slack: {
    routeByAssignedApprover: true,
    snapshotSlackRecipientOnRequest: true,
    verifySlackSignature: true,
    idempotentInteractions: true,
    retryFailedDelivery: true,
    recordMessageChannelAndTimestamp: true,
  },
};

const schema = {
  version: 5,
  collections: {
    employees: {
      documentId: 'lowercase email',
      fields: ['email', 'name', 'hireDate', 'teamId', 'position', 'permission', 'slackUserId', 'active', 'employmentStatus', 'profileStatus', 'leaveMutationVersion', 'leaveMutationAt', 'createdAt', 'updatedAt'],
    },
    teams: {
      documentId: 'stable team key',
      fields: ['name', 'managerEmail', 'active', 'createdAt', 'updatedAt'],
    },
    leave_policies: {
      documentId: 'immutable policy version',
      fields: ['annualLeave', 'rewardLeave', 'requests', 'approval', 'cancellation', 'employees', 'slack'],
    },
    leave_ledger: {
      documentId: 'auto id',
      fields: ['employeeEmail', 'source', 'entryType', 'days', 'effectiveDate', 'requestId', 'rewardGrantId', 'reason', 'idempotencyKey', 'createdAt', 'createdBy'],
    },
    reward_grants: {
      documentId: 'auto id',
      fields: ['employeeEmail', 'grantedDays', 'grantedOn', 'expiresOn', 'memo', 'active', 'reclaimedDays', 'reclaimedAt', 'reclaimedBy', 'mutationVersion', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
    },
    reward_allocations: {
      documentId: 'auto id',
      fields: ['requestId', 'usageDate', 'rewardGrantId', 'days', 'status', 'createdAt'],
    },
    leave_requests: {
      documentId: 'auto id',
      fields: ['applicantEmail', 'applicantName', 'source', 'duration', 'startDate', 'endDate', 'workDates', 'days', 'reason', 'approverEmail', 'approverName', 'approverSlackUserId', 'status', 'createdAt', 'decidedAt', 'decidedBy', 'cancelledFromStatus', 'cancellationBalanceRestored', 'cancelledAt', 'cancelledBy', 'updatedAt'],
    },
    notification_logs: {
      documentId: 'auto id',
      fields: ['requestId', 'provider', 'recipientSlackUserId', 'channelId', 'messageTs', 'eventType', 'status', 'attempts', 'lastError', 'createdAt', 'updatedAt'],
    },
    audit_logs: {
      documentId: 'auto id or idempotent system event id',
      fields: ['actorEmail', 'action', 'targetType', 'targetId', 'before', 'after', 'createdAt'],
    },
    operation_logs: {
      documentId: 'auto id',
      fields: ['outcome', 'operation', 'actorEmail', 'targetType', 'targetId', 'message', 'resolvedAt', 'resolvedBy', 'createdAt'],
    },
  },
};

const teamSeeds = [
  { id: 'platform', name: '플랫폼팀' },
  { id: 'ai-research', name: 'AI Research팀' },
  { id: 'strategy-planning', name: '전략기획팀' },
  { id: 'management-support', name: '경영지원팀' },
];

await db.runTransaction(async transaction => {
  const policyRef = db.collection('leave_policies').doc(POLICY_ID);
  const schemaRef = db.collection('schema_versions').doc(SCHEMA_ID);
  const settingsRef = db.collection('system_settings').doc('current');
  const teamRefs = teamSeeds.map(team => db.collection('teams').doc(team.id));
  const adminRefs = adminEmails.map(email => db.collection('employees').doc(email));
  const refs = [policyRef, schemaRef, settingsRef, ...teamRefs, ...adminRefs];
  const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));

  const [policySnapshot, schemaSnapshot, , ...remaining] = snapshots;
  const teamSnapshots = remaining.slice(0, teamRefs.length);
  const adminSnapshots = remaining.slice(teamRefs.length);

  if (!policySnapshot.exists) transaction.create(policyRef, { ...leavePolicy, createdAt: FieldValue.serverTimestamp() });
  if (!schemaSnapshot.exists) transaction.create(schemaRef, { ...schema, createdAt: FieldValue.serverTimestamp() });
  transaction.set(settingsRef, { activeLeavePolicyId: POLICY_ID, activeSchemaVersion: SCHEMA_ID, timezone: 'Asia/Seoul', updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  teamSeeds.forEach((team, index) => {
    if (!teamSnapshots[index].exists) transaction.create(teamRefs[index], { name: team.name, managerEmail: '', active: true, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });

  adminEmails.forEach((email, index) => {
    const snapshot = adminSnapshots[index];
    if (snapshot.exists) {
      const data = snapshot.data();
      const legacyPosition = data.position ?? data.organizationRole;
      const position = data.profileStatus === 'INCOMPLETE'
        ? 'EMPLOYEE'
        : ['EMPLOYEE', 'TEAM_LEAD', 'REPRESENTATIVE'].includes(legacyPosition) ? legacyPosition : 'EMPLOYEE';
      transaction.set(adminRefs[index], {
        position,
        permission: 'ADMIN',
        jobTitle: FieldValue.delete(),
        organizationRole: FieldValue.delete(),
        isAdmin: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }
    transaction.create(adminRefs[index], {
      email,
      name: email.split('@')[0],
      hireDate: null,
      teamId: '',
      position: 'EMPLOYEE',
      permission: 'ADMIN',
      slackUserId: '',
      active: true,
      employmentStatus: 'ACTIVE',
      profileStatus: 'INCOMPLETE',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  transaction.set(db.collection('audit_logs').doc('system-init-v5'), {
    actorEmail: adminEmails[0],
    action: 'INITIALIZE_SYSTEM',
    targetType: 'SYSTEM',
    targetId: projectId,
    schemaVersion: SCHEMA_ID,
    policyId: POLICY_ID,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
});

console.log(`Firestore 초기화를 완료했습니다: ${projectId}`);
console.log(`정책: ${POLICY_ID}`);
console.log(`팀: ${teamSeeds.length}개`);
console.log(`초기 관리자: ${adminEmails.length}명`);
