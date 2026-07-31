import 'server-only';

import crypto from 'crypto';
import type {
  LeaveDuration,
  LeaveIntegrationRequest,
  LeaveSource,
} from './leave-store';

export type { LeaveIntegrationRequest } from './leave-store';

type DemoSlackActionTarget = {
  mode: 'demo';
  request: LeaveIntegrationRequest;
  allowedSlackUserId: string;
  issuedAt: number;
};

type LiveSlackActionTarget = {
  mode: 'live';
  requestId: string;
  allowedSlackUserId: string;
  issuedAt: number;
};

export type SlackActionTarget = DemoSlackActionTarget | LiveSlackActionTarget;

export type SlackBlockActionPayload = {
  type?: string;
  team?: { id?: string };
  user?: { id?: string; username?: string; name?: string };
  channel?: { id?: string };
  message?: {
    ts?: string;
    blocks?: Array<Record<string, unknown> & {
      block_id?: string;
      text?: { text?: string };
    }>;
  };
  actions?: Array<{ action_id?: string; value?: string }>;
};

type SlackApiResponse = {
  ok: boolean;
  error?: string;
  channel?: { id?: string } | string;
  ts?: string;
  user?: { id?: string };
};

type AppsScriptOperationResponse = {
  ok?: boolean;
  error?: string;
};

type AppsScriptBridgeResponse = {
  ok?: boolean;
  error?: string;
  result?: {
    calendar?: AppsScriptOperationResponse;
    email?: AppsScriptOperationResponse;
  };
};

export type ApprovalIntegrationResult = {
  calendar: PromiseSettledResult<void>;
  email: PromiseSettledResult<void>;
};

type AppsScriptAction = 'APPROVE' | 'CANCEL';

const SOURCE_LABEL: Record<LeaveSource, string> = {
  ANNUAL: '정기 연차',
  REWARD: '포상휴가',
};

const DURATION_LABEL: Record<LeaveDuration, string> = {
  FULL_DAY: '종일',
  AM_HALF: '오전 반차',
  PM_HALF: '오후 반차',
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

function slackSigningSecret() {
  return requiredEnv('SLACK_SIGNING_SECRET');
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function escapeSlackText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function leaveTypeLabel(request: Pick<LeaveIntegrationRequest, 'source' | 'duration'>) {
  return request.duration === 'FULL_DAY'
    ? SOURCE_LABEL[request.source]
    : `${SOURCE_LABEL[request.source]} · ${DURATION_LABEL[request.duration]}`;
}

function periodLabel(request: Pick<LeaveIntegrationRequest, 'startDate' | 'endDate'>) {
  return request.startDate === request.endDate
    ? request.startDate
    : `${request.startDate} ~ ${request.endDate}`;
}

function slackRequestSummary(request: LeaveIntegrationRequest) {
  return [
    '휴가 사용 요청이 있습니다.',
    '',
    `요청자: ${request.applicantName}`,
    `기간: ${request.startDate} ~ ${request.endDate}`,
    `종류: ${leaveTypeLabel(request)}`,
    `사유: ${request.reason || '-'}`,
  ].join('\n');
}

function signSlackActionTarget(target: SlackActionTarget) {
  const payload = base64Url(JSON.stringify(target));
  const signature = base64Url(crypto.createHmac('sha256', slackSigningSecret()).update(payload).digest());
  return `${payload}.${signature}`;
}

export function verifySlackActionTarget(value: string) {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) throw new Error('Slack 버튼 데이터가 올바르지 않습니다.');
  const expected = base64Url(crypto.createHmac('sha256', slackSigningSecret()).update(payload).digest());
  if (!safeEqual(signature, expected)) throw new Error('Slack 버튼 데이터의 서명이 올바르지 않습니다.');

  const target = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SlackActionTarget;
  if (target.mode !== 'demo' && target.mode !== 'live') throw new Error('Slack 버튼 처리 모드를 확인할 수 없습니다.');
  if (!target.allowedSlackUserId || !target.issuedAt) throw new Error('Slack 버튼 데이터가 불완전합니다.');
  return target;
}

export function verifySlackRequest(rawBody: string, timestamp: string | null, signature: string | null) {
  if (!timestamp || !signature) throw new Error('Slack 요청 서명 헤더가 없습니다.');
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60) {
    throw new Error('Slack 요청 시간이 유효하지 않습니다.');
  }
  const expected = `v0=${crypto
    .createHmac('sha256', slackSigningSecret())
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;
  if (!safeEqual(signature, expected)) throw new Error('Slack 요청 서명이 올바르지 않습니다.');
}

function slackToken() {
  return requiredEnv('SLACK_BOT_TOKEN');
}

async function slackApi<T extends SlackApiResponse>(method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${slackToken()}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json() as T;
  if (!response.ok || !result.ok) {
    throw new Error(`Slack ${method} 실패: ${result.error ?? response.status}`);
  }
  return result;
}

async function slackUserIdForEmail(email: string) {
  const result = await slackApi<SlackApiResponse>('users.lookupByEmail', { email });
  const userId = result.user?.id;
  if (!userId) throw new Error(`${email}에 해당하는 Slack 사용자를 찾지 못했습니다.`);
  return userId;
}

async function resolveSlackRecipient(request: LeaveIntegrationRequest, demo: boolean) {
  if (demo) {
    const configuredUserId = process.env.SLACK_DEMO_USER_ID?.trim();
    if (configuredUserId) return configuredUserId;
    return slackUserIdForEmail(process.env.LEAVE_DEMO_RECIPIENT_EMAIL?.trim() || 'paradise@safeai.kr');
  }
  if (request.approverSlackUserId) return request.approverSlackUserId;
  return slackUserIdForEmail(request.approverEmail);
}

function slackRequestBlocks(request: LeaveIntegrationRequest, actionValue: string) {
  return [
    {
      type: 'section',
      block_id: 'leave_reason',
      text: {
        type: 'plain_text',
        text: `${slackRequestSummary(request)}\n\n승인하시겠습니까?`,
        emoji: true,
      },
    },
    {
      type: 'actions',
      block_id: 'leave_decision_actions',
      elements: [
        {
          type: 'button',
          action_id: 'leave_approve',
          text: { type: 'plain_text', text: '승인', emoji: true },
          style: 'primary',
          value: actionValue,
        },
        {
          type: 'button',
          action_id: 'leave_reject',
          text: { type: 'plain_text', text: '반려', emoji: true },
          style: 'danger',
          value: actionValue,
          confirm: {
            title: { type: 'plain_text', text: '연차 신청 반려' },
            text: { type: 'mrkdwn', text: '이 신청을 반려하시겠습니까?' },
            confirm: { type: 'plain_text', text: '반려' },
            deny: { type: 'plain_text', text: '취소' },
          },
        },
      ],
    },
  ];
}

export async function sendLeaveRequestSlackNotification(request: LeaveIntegrationRequest, demo: boolean) {
  const userId = await resolveSlackRecipient(request, demo);
  const target: SlackActionTarget = demo
    ? {
        mode: 'demo',
        request: { ...request, reason: '' },
        allowedSlackUserId: userId,
        issuedAt: Date.now(),
      }
    : { mode: 'live', requestId: request.requestId, allowedSlackUserId: userId, issuedAt: Date.now() };
  const actionValue = signSlackActionTarget(target);
  const conversation = await slackApi<SlackApiResponse>('conversations.open', { users: userId, return_im: true });
  const channelId = typeof conversation.channel === 'string'
    ? conversation.channel
    : conversation.channel?.id;
  if (!channelId) throw new Error('Slack 개인 메시지 채널을 열지 못했습니다.');

  const message = await slackApi<SlackApiResponse>('chat.postMessage', {
    channel: channelId,
    text: `${request.applicantName}님의 ${leaveTypeLabel(request)} 승인 요청`,
    blocks: slackRequestBlocks(request, actionValue),
  });
  if (!message.ts) throw new Error('Slack 메시지 식별값을 받지 못했습니다.');
  return { channelId, messageTs: message.ts, slackUserId: userId };
}

export function slackReasonFromPayload(payload: SlackBlockActionPayload) {
  const text = payload.message?.blocks?.find(block => block.block_id === 'leave_reason')?.text?.text ?? '';
  const reasonPrefix = '사유: ';
  const promptSuffix = '\n\n승인하시겠습니까?';
  const reasonStart = text.indexOf(reasonPrefix);
  const reasonEnd = text.lastIndexOf(promptSuffix);
  if (reasonStart < 0) return '';
  return text.slice(
    reasonStart + reasonPrefix.length,
    reasonEnd > reasonStart ? reasonEnd : undefined,
  );
}

export function slackRequestSummaryFromPayload(payload: SlackBlockActionPayload) {
  const text = payload.message?.blocks?.find(block => block.block_id === 'leave_reason')?.text?.text ?? '';
  return text.replace(/\n\n승인하시겠습니까\?$/, '').trim();
}

export async function updateSlackProcessingMessage(input: {
  channelId: string;
  messageTs: string;
  action: 'approve' | 'reject';
  request?: LeaveIntegrationRequest;
  requestSummary?: string;
}) {
  const actionLabel = input.action === 'approve' ? '승인' : '반려';
  const requestSummary = input.requestSummary || (input.request ? slackRequestSummary(input.request) : '');
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `⏳ ${actionLabel} 처리 중`, emoji: true },
    },
  ];
  if (requestSummary) {
    blocks.push({
      type: 'section',
      text: { type: 'plain_text', text: requestSummary.slice(0, 2_900), emoji: true },
    });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '요청을 처리하고 있습니다. 잠시만 기다려 주세요.' }],
  });
  await slackApi<SlackApiResponse>('chat.update', {
    channel: input.channelId,
    ts: input.messageTs,
    text: `${actionLabel} 요청을 처리하고 있습니다.`,
    blocks,
  });
}

export async function updateSlackDecisionFailureMessage(input: {
  channelId: string;
  messageTs: string;
  requestSummary?: string;
  errorMessage?: string;
}) {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '⚠️ 처리 실패', emoji: true },
    },
  ];
  if (input.requestSummary) {
    blocks.push({
      type: 'section',
      text: { type: 'plain_text', text: input.requestSummary.slice(0, 2_900), emoji: true },
    });
  }
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: escapeSlackText(input.errorMessage || '요청을 처리하지 못했습니다. 웹페이지에서 상태를 확인해 주세요.'),
    }],
  });
  await slackApi<SlackApiResponse>('chat.update', {
    channel: input.channelId,
    ts: input.messageTs,
    text: '연차 신청을 처리하지 못했습니다.',
    blocks,
  });
}

export async function updateSlackDecisionMessage(input: {
  request: LeaveIntegrationRequest;
  channelId: string;
  messageTs: string;
  action: 'approve' | 'reject';
  actorLabel: string;
  integrationWarning?: string;
}) {
  const status = input.action === 'approve' ? '승인 완료' : '반려 완료';
  const statusEmoji = input.action === 'approve' ? '✅' : '⛔';
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${statusEmoji} ${status}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*신청자*\n${escapeSlackText(input.request.applicantName)}` },
        { type: 'mrkdwn', text: `*연차 종류*\n${escapeSlackText(leaveTypeLabel(input.request))}` },
        { type: 'mrkdwn', text: `*기간*\n${escapeSlackText(periodLabel(input.request))}` },
        { type: 'mrkdwn', text: `*처리자*\n${escapeSlackText(input.actorLabel)}` },
      ],
    },
  ];
  if (input.integrationWarning) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `⚠️ ${escapeSlackText(input.integrationWarning)}` }],
    });
  }
  await slackApi<SlackApiResponse>('chat.update', {
    channel: input.channelId,
    ts: input.messageTs,
    text: `${input.request.applicantName}님의 연차 신청이 ${status}되었습니다.`,
    blocks,
  });
}

function fulfilled(): PromiseFulfilledResult<void> {
  return { status: 'fulfilled', value: undefined };
}

function rejected(message: string): PromiseRejectedResult {
  return { status: 'rejected', reason: new Error(message) };
}

function settledOperation(
  operation: AppsScriptOperationResponse | undefined,
  fallbackMessage: string,
): PromiseSettledResult<void> {
  return operation?.ok ? fulfilled() : rejected(operation?.error || fallbackMessage);
}

async function callAppsScript(
  request: LeaveIntegrationRequest,
  demo: boolean,
  action: AppsScriptAction,
): Promise<NonNullable<AppsScriptBridgeResponse['result']>> {
  const payload = JSON.stringify({
    action,
    timestamp: Date.now(),
    requestId: request.requestId,
    applicantEmail: request.applicantEmail,
    applicantName: request.applicantName,
    startDate: request.startDate,
    endDate: request.endDate,
    leaveType: leaveTypeLabel(request),
    reason: request.reason || '-',
    demo,
  });

  let response: Response;
  try {
    const signature = crypto
      .createHmac('sha256', requiredEnv('GOOGLE_APPS_SCRIPT_SHARED_SECRET'))
      .update(payload)
      .digest('hex');
    response = await fetch(requiredEnv('GOOGLE_APPS_SCRIPT_WEB_APP_URL'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ payload, signature }),
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Apps Script 호출에 실패했습니다.');
  }

  const responseText = await response.text();
  let result: AppsScriptBridgeResponse;
  try {
    result = JSON.parse(responseText) as AppsScriptBridgeResponse;
  } catch {
    throw new Error(`Apps Script 응답 형식이 올바르지 않습니다. HTTP ${response.status}`);
  }

  if (!result.result) {
    throw new Error(result.error || `Apps Script 호출 실패: HTTP ${response.status}`);
  }
  return result.result;
}

export async function runApprovedLeaveIntegrations(
  request: LeaveIntegrationRequest,
  demo: boolean,
): Promise<ApprovalIntegrationResult> {
  let result: NonNullable<AppsScriptBridgeResponse['result']>;
  try {
    result = await callAppsScript(request, demo, 'APPROVE');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Apps Script 호출에 실패했습니다.';
    return {
      calendar: rejected(`Apps Script 캘린더 호출 실패: ${message}`),
      email: rejected(`Apps Script 메일 호출 실패: ${message}`),
    };
  }

  return {
    calendar: settledOperation(result.calendar, 'Apps Script 캘린더 등록에 실패했습니다.'),
    email: settledOperation(result.email, 'Apps Script 메일 발송에 실패했습니다.'),
  };
}

export async function runCancelledLeaveIntegration(
  request: LeaveIntegrationRequest,
  demo: boolean,
): Promise<PromiseSettledResult<void>> {
  try {
    const result = await callAppsScript(request, demo, 'CANCEL');
    return settledOperation(result.calendar, 'Apps Script 캘린더 삭제에 실패했습니다.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Apps Script 호출에 실패했습니다.';
    return rejected(`Apps Script 캘린더 삭제 호출 실패: ${message}`);
  }
}

export function integrationFailureSummary(result: ApprovalIntegrationResult) {
  const failures: string[] = [];
  if (result.calendar.status === 'rejected') failures.push('캘린더 등록 실패');
  if (result.email.status === 'rejected') failures.push('메일 발송 실패');
  return failures.join(', ');
}
