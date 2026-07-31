import { after, NextRequest, NextResponse } from 'next/server';
import {
  integrationFailureSummary,
  runApprovedLeaveIntegrations,
  slackReasonFromPayload,
  slackRequestSummaryFromPayload,
  type SlackBlockActionPayload,
  updateSlackDecisionFailureMessage,
  updateSlackDecisionMessage,
  updateSlackProcessingMessage,
  verifySlackActionTarget,
  verifySlackRequest,
} from '../../../../lib/leave-integrations';
import {
  decideLeaveRequest,
  employeeEmailForSlackUser,
  recordOperationFailure,
} from '../../../../lib/leave-store';

function actionFromPayload(payload: SlackBlockActionPayload) {
  const action = payload.actions?.[0];
  if (action?.action_id === 'leave_approve') return { action: 'approve' as const, value: action.value };
  if (action?.action_id === 'leave_reject') return { action: 'reject' as const, value: action.value };
  return null;
}

function decisionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const expectedMessages = [
    '이미 처리된 신청',
    '담당 승인자',
    '등록이 완료된 활성 사내 승인자',
    '비활성 직원',
    '잔액',
    '본인의 신청',
  ];
  return expectedMessages.some(expected => message.includes(expected))
    ? message
    : '요청을 처리하지 못했습니다. 웹페이지에서 상태를 확인해 주세요.';
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    verifySlackRequest(
      rawBody,
      request.headers.get('x-slack-request-timestamp'),
      request.headers.get('x-slack-signature'),
    );
  } catch (error) {
    console.error('slack_request_verification_failed', error);
    return NextResponse.json({ error: 'Slack 요청을 확인할 수 없습니다.' }, { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const rawPayload = form.get('payload');
  if (!rawPayload) return NextResponse.json({ error: 'Slack 요청 데이터가 없습니다.' }, { status: 400 });

  let payload: SlackBlockActionPayload;
  try {
    payload = JSON.parse(rawPayload) as SlackBlockActionPayload;
  } catch {
    return NextResponse.json({ error: 'Slack 요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const configuredTeamId = process.env.SLACK_TEAM_ID?.trim();
  if (configuredTeamId && payload.team?.id !== configuredTeamId) {
    return NextResponse.json({ error: '허용되지 않은 Slack 워크스페이스입니다.' }, { status: 403 });
  }

  const selected = actionFromPayload(payload);
  const slackUserId = payload.user?.id ?? '';
  const channelId = payload.channel?.id ?? '';
  const messageTs = payload.message?.ts ?? '';
  if (!selected?.value || !slackUserId || !channelId || !messageTs) {
    return NextResponse.json({ error: 'Slack 버튼 처리 정보가 불완전합니다.' }, { status: 400 });
  }

  let target;
  try {
    target = verifySlackActionTarget(selected.value);
  } catch (error) {
    console.error('slack_action_target_verification_failed', error);
    return NextResponse.json({ error: 'Slack 버튼을 확인할 수 없습니다.' }, { status: 401 });
  }
  if (target.allowedSlackUserId !== slackUserId) {
    return NextResponse.json({ error: '이 신청의 승인자가 아닙니다.' }, { status: 403 });
  }

  const requestSummary = slackRequestSummaryFromPayload(payload);
  const slackActorLabel = payload.user?.username || payload.user?.name || slackUserId;

  if (target.mode === 'demo') {
    const demoRequest = {
      ...target.request,
      reason: slackReasonFromPayload(payload),
    };
    after(async () => {
      try {
        await updateSlackProcessingMessage({
          channelId,
          messageTs,
          action: selected.action,
          requestSummary,
        });
      } catch (error) {
        console.error('demo_slack_processing_message_update_failed', error);
      }

      let warning = '';
      if (selected.action === 'approve') {
        const result = await runApprovedLeaveIntegrations(demoRequest, true);
        warning = integrationFailureSummary(result);
        if (result.calendar.status === 'rejected') console.error('demo_calendar_integration_failed', result.calendar.reason);
        if (result.email.status === 'rejected') console.error('demo_email_integration_failed', result.email.reason);
      }
      try {
        await updateSlackDecisionMessage({
          request: demoRequest,
          channelId,
          messageTs,
          action: selected.action,
          actorLabel: slackActorLabel,
          integrationWarning: warning,
        });
      } catch (error) {
        console.error('demo_slack_message_update_failed', error);
      }
    });
    return new NextResponse(null, { status: 200 });
  }

  const requestId = target.requestId;
  after(async () => {
    try {
      await updateSlackProcessingMessage({
        channelId,
        messageTs,
        action: selected.action,
        requestSummary,
      });
    } catch (error) {
      console.error('slack_processing_message_update_failed', error);
    }

    let actorEmail = '';
    let decision: Awaited<ReturnType<typeof decideLeaveRequest>>;
    try {
      actorEmail = await employeeEmailForSlackUser(slackUserId);
      decision = await decideLeaveRequest(requestId, actorEmail, selected.action);
    } catch (error) {
      console.error('slack_leave_decision_failed', error);
      try {
        await updateSlackDecisionFailureMessage({
          channelId,
          messageTs,
          requestSummary,
          errorMessage: decisionErrorMessage(error),
        });
      } catch (messageError) {
        console.error('slack_failure_message_update_failed', messageError);
      }
      return;
    }

    let warning = '';
    if (selected.action === 'approve') {
      const result = await runApprovedLeaveIntegrations(decision.integrationRequest, false);
      warning = integrationFailureSummary(result);
      const failureLogs: Promise<unknown>[] = [];
      if (result.calendar.status === 'rejected') {
        failureLogs.push(recordOperationFailure({
          actorEmail,
          operation: 'CREATE_CALENDAR_EVENT',
          targetType: 'LEAVE_REQUEST',
          targetId: requestId,
          error: result.calendar.reason,
        }));
      }
      if (result.email.status === 'rejected') {
        failureLogs.push(recordOperationFailure({
          actorEmail,
          operation: 'SEND_APPROVAL_EMAIL',
          targetType: 'LEAVE_REQUEST',
          targetId: requestId,
          error: result.email.reason,
        }));
      }
      await Promise.allSettled(failureLogs);
    }

    try {
      await updateSlackDecisionMessage({
        request: decision.integrationRequest,
        channelId,
        messageTs,
        action: selected.action,
        actorLabel: actorEmail,
        integrationWarning: warning,
      });
    } catch (error) {
      try {
        await recordOperationFailure({
          actorEmail,
          operation: 'UPDATE_SLACK_MESSAGE',
          targetType: 'LEAVE_REQUEST',
          targetId: requestId,
          error,
        });
      } catch (loggingError) {
        console.error('slack_message_update_failure_log_failed', loggingError);
      }
    }
  });
  return new NextResponse(null, { status: 200 });
}
