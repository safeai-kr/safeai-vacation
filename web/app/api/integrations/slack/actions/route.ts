import { after, NextRequest, NextResponse } from 'next/server';
import {
  integrationFailureSummary,
  runApprovedLeaveIntegrations,
  slackReasonFromPayload,
  type SlackBlockActionPayload,
  updateSlackDecisionMessage,
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

  if (target.mode === 'demo') {
    const demoRequest = {
      ...target.request,
      reason: slackReasonFromPayload(payload),
    };
    after(async () => {
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
          actorLabel: payload.user?.username || payload.user?.name || slackUserId,
          integrationWarning: warning,
        });
      } catch (error) {
        console.error('demo_slack_message_update_failed', error);
      }
    });
    return new NextResponse(null, { status: 200 });
  }

  try {
    const actorEmail = await employeeEmailForSlackUser(slackUserId);
    const decision = await decideLeaveRequest(target.requestId, actorEmail, selected.action);
    after(async () => {
      let warning = '';
      if (selected.action === 'approve') {
        const result = await runApprovedLeaveIntegrations(decision.integrationRequest, false);
        warning = integrationFailureSummary(result);
        if (result.calendar.status === 'rejected') {
          await recordOperationFailure({
            actorEmail,
            operation: 'CREATE_CALENDAR_EVENT',
            targetType: 'LEAVE_REQUEST',
            targetId: target.requestId,
            error: result.calendar.reason,
          });
        }
        if (result.email.status === 'rejected') {
          await recordOperationFailure({
            actorEmail,
            operation: 'SEND_APPROVAL_EMAIL',
            targetType: 'LEAVE_REQUEST',
            targetId: target.requestId,
            error: result.email.reason,
          });
        }
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
        await recordOperationFailure({
          actorEmail,
          operation: 'UPDATE_SLACK_MESSAGE',
          targetType: 'LEAVE_REQUEST',
          targetId: target.requestId,
          error,
        });
      }
    });
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error('slack_leave_decision_failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '연차 신청을 처리하지 못했습니다.' },
      { status: 409 },
    );
  }
}
