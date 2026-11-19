import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as apiError from '../app/lib/api-error.ts';
import * as balancePolicy from '../app/lib/leave-balance-policy.ts';
import * as cancellationPolicy from '../app/lib/leave-cancellation-policy.ts';
import * as registrationPolicy from '../app/lib/admin-leave-registration-policy.ts';

const admin = 'ceo@safeai.kr';
const employee = 'member@safeai.kr';
const teamLead = 'platform.lead@safeai.kr';
const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
function futureWeekday(offset = 3) {
  const date = new Date(`${kstToday()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function input(extra = {}) {
  return { employeeEmail: employee, duration: 'FULL_DAY', startDate: futureWeekday(), endDate: futureWeekday(), reason: '불가피한 일정으로 관리자 사용 확정', registrationKey: randomUUID(), ...extra };
}

// Load the real store with only infrastructure replaced. No Firebase or Slack calls.
function storeWithDatabase() {
  const rows = new Map();
  class FakeTimestamp {
    toDate() { return new Date(); }
  }
  const fieldValue = { serverTimestamp: () => new FakeTimestamp(), increment: value => ({ increment: value }) };
  const docSnapshot = ref => ({ id: ref.id, ref, exists: rows.has(ref.path), data: () => rows.get(ref.path) });
  const collection = name => {
    const query = (filters = []) => ({
      where: (field, operator, value) => { assert.equal(operator, '=='); return query([...filters, [field, value]]); },
      orderBy: () => query(filters),
      limit: () => query(filters),
      get: async () => {
        const docs = [...rows.keys()].filter(path => path.startsWith(`${name}/`))
          .map(path => docSnapshot({ path, id: path.slice(name.length + 1) }))
          .filter(doc => filters.every(([field, value]) => doc.data()[field] === value));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    });
    return { ...query(), doc: (id = randomUUID()) => {
      const ref = { id, path: `${name}/${id}` };
      ref.get = async () => docSnapshot(ref);
      return ref;
    } };
  };
  const db = {
    collection,
    runTransaction: async run => {
      const writes = [];
      let startedWrites = false;
      const transaction = {
        get: async ref => { assert.equal(startedWrites, false, 'transaction reads must precede writes'); return ref.get(); },
        create: (ref, data) => { startedWrites = true; writes.push({ type: 'create', ref, data }); },
        update: (ref, data) => { startedWrites = true; writes.push({ type: 'update', ref, data }); },
      };
      const result = await run(transaction);
      for (const write of writes) {
        if (write.type === 'create') assert.equal(rows.has(write.ref.path), false, 'duplicate document creation');
        else assert.equal(rows.has(write.ref.path), true, 'missing update target');
      }
      for (const { type, ref, data } of writes) {
        const previous = rows.get(ref.path) ?? {};
        const next = Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
          value && typeof value === 'object' && 'increment' in value ? (previous[key] ?? 0) + value.increment : value]));
        rows.set(ref.path, type === 'create' ? next : { ...previous, ...next });
      }
      return result;
    },
  };
  for (const [email, permission] of [[admin, 'ADMIN'], [employee, 'GENERAL'], [teamLead, 'GENERAL']]) {
    rows.set(`employees/${email}`, { email, name: email === admin ? '김대표' : '테스트 직원', hireDate: kstToday(), active: true, profileStatus: 'COMPLETE', permission });
  }
  const filename = fileURLToPath(new URL('../app/lib/leave-store.ts', import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename);
  const nativeRequire = createRequire(filename);
  const mocks = {
    'server-only': {},
    '@google-cloud/firestore': { FieldValue: fieldValue, Timestamp: FakeTimestamp },
    './auth': { isDemoMode: () => true },
    './api-error': apiError,
    './firebase-admin': { firestore: () => db },
    './approval-routing-policy': { resolveApprovalRoute: () => ({ ok: true, approver: { email: admin, name: '김대표' } }) },
    './leave-balance-policy': balancePolicy,
    './leave-cancellation-policy': cancellationPolicy,
    './admin-leave-registration-policy': registrationPolicy,
    './reward-grant-policy': {},
  };
  loaded.require = name => name in mocks ? mocks[name] : nativeRequire(name);
  loaded._compile(compiled, filename);
  return { store: loaded.exports, rows, entries: name => [...rows.entries()].filter(([key]) => key.startsWith(`${name}/`)).map(([, data]) => data) };
}

test('잔액 0인 직원의 관리자 등록은 즉시 승인하고 원장·감사 기록을 함께 저장한다', async () => {
  const { store, entries } = storeWithDatabase();
  const result = await store.registerAdminLeave(admin, input());
  assert.equal(result.balanceAfterRegistration, -1);
  assert.equal(entries('leave_requests')[0].status, 'APPROVED');
  assert.equal(entries('leave_requests')[0].registrationType, 'ADMIN');
  assert.equal(entries('leave_requests')[0].registeredBy, admin);
  assert.equal(entries('leave_requests')[0].registeredByName, '김대표');
  assert.equal(entries('leave_ledger')[0].days, -1);
  assert.equal(entries('leave_ledger')[0].requestId, result.requestId);
  assert.equal(entries('audit_logs')[0].action, 'ADMIN_REGISTER_LEAVE');
  assert.equal(entries('audit_logs')[0].balanceAfterRegistration, -1);
  assert.equal(entries('audit_logs')[0].reason, '불가피한 일정으로 관리자 사용 확정');
});

test('등록 재시도는 중복 차감하지 않고 같은 키로 다른 내용을 보내면 거부한다', async () => {
  const { store, entries } = storeWithDatabase();
  const value = input();
  const first = await store.registerAdminLeave(admin, value);
  const retry = await store.registerAdminLeave(admin, value);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(retry.alreadyRegistered, true);
  assert.equal(entries('leave_ledger').length, 1);
  assert.equal(entries('audit_logs').length, 1);
  await assert.rejects(store.registerAdminLeave(admin, { ...value, reason: '다른 사유' }), /다른 내용/);
});

test('일반 직원과 팀장은 관리자 등록을 할 수 없다', async () => {
  const { store, entries } = storeWithDatabase();
  await assert.rejects(store.registerAdminLeave(employee, input()), /관리 권한/);
  await assert.rejects(store.registerAdminLeave(teamLead, input()), /관리 권한/);
  assert.equal(entries('leave_requests').length, 0);
  assert.equal(entries('leave_ledger').length, 0);
});

test('반차는 0.5일 차감하고 동일 시간대의 중복 사용을 차단한다', async () => {
  const { store, entries } = storeWithDatabase();
  await store.registerAdminLeave(admin, input({ duration: 'AM_HALF' }));
  assert.equal(entries('leave_ledger')[0].days, -0.5);
  await assert.rejects(store.registerAdminLeave(admin, input({ duration: 'AM_HALF' })), /이미 승인/);
  await store.registerAdminLeave(admin, input({ duration: 'PM_HALF' }));
  assert.equal(entries('leave_ledger').reduce((sum, row) => sum + row.days, 0), -1);
});

test('관리자 등록은 일반 선연차 3일 한도를 넘어도 가능하며 일반 신청 한도는 유지한다', async () => {
  const { store, rows } = storeWithDatabase();
  rows.set('leave_ledger/prior-use', { employeeEmail: employee, source: 'ANNUAL', entryType: 'USE', days: -3, effectiveDate: kstToday() });
  const result = await store.registerAdminLeave(admin, input());
  assert.equal(result.balanceAfterRegistration, -4);
  const availability = balancePolicy.calculateAnnualLeaveAvailability({ ledgerBalanceDays: -4, pendingDays: 0, futureMonthlyGrantDays: 11 });
  assert.equal(balancePolicy.hasSufficientAnnualLeaveBalance(0.5, availability), false);
});

test('과거 사용 건은 실제 사용일을 보존하면서 등록 시점 잔액에 반영한다', async () => {
  const { store, rows, entries } = storeWithDatabase();
  const target = rows.get(`employees/${employee}`);
  target.hireDate = kstToday().slice(0, 8) + '01';
  const date = new Date(`${target.hireDate}T00:00:00.000Z`);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  const usedOn = date.toISOString().slice(0, 10);
  await store.registerAdminLeave(admin, input({ startDate: usedOn, endDate: usedOn }));
  assert.equal(entries('leave_requests')[0].startDate, usedOn);
  assert.equal(entries('leave_ledger')[0].usageDate, usedOn);
  assert.equal(entries('leave_ledger')[0].effectiveDate, kstToday());
});

test('미래 관리자 등록 건도 기존 취소 경로로 원장을 복구할 수 있다', async () => {
  const { store, entries } = storeWithDatabase();
  const { requestId } = await store.registerAdminLeave(admin, input());
  const result = await store.cancelLeaveRequest(requestId, admin);
  assert.equal(result.balanceRestored, true);
  assert.equal(entries('leave_requests')[0].status, 'CANCELLED');
  assert.equal(entries('leave_ledger').reduce((sum, row) => sum + row.days, 0), 0);
});

test('잘못된 날짜·주말·사유 누락은 등록 전에 차단한다', () => {
  assert.equal(registrationPolicy.validateAdminLeaveRegistration(input({ startDate: '2026-02-30', endDate: '2026-02-30' })).ok, false);
  assert.equal(registrationPolicy.validateAdminLeaveRegistration(input({ startDate: '2026-11-21', endDate: '2026-11-22' })).ok, false);
  assert.equal(registrationPolicy.validateAdminLeaveRegistration(input({ reason: '  ' })).ok, false);
});

test('데모에서도 등록·음수 잔액·본인 신청·관리자 이력을 확인하고 재시도는 중복 반영하지 않는다', async () => {
  delete globalThis.__leaveDemoState;
  const { store } = storeWithDatabase();
  const value = input({ duration: 'AM_HALF' });
  const first = store.registerDemoAdminLeave(admin, value);
  const retry = store.registerDemoAdminLeave(admin, value);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(retry.alreadyRegistered, true);
  const dashboard = await store.fetchLeaveDashboard(employee);
  assert.equal(dashboard.balances[0].annualNetRemainingDays, -1); // 0.5 - new 0.5 - existing pending 1
  assert.equal(dashboard.requests.find(row => row.requestId === first.requestId).registrationType, 'ADMIN');
  const history = await store.fetchAdminOperationRecords(admin, dashboard.requests);
  assert.equal(history.history[0].action, 'ADMIN_REGISTER_LEAVE');
  assert.throws(() => store.registerDemoAdminLeave(teamLead, input()), /관리자만/);
  delete globalThis.__leaveDemoState;
});
