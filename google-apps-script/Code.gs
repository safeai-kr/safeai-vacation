/**
 * 연차 웹앱에서 승인 또는 취소된 신청을 받아 Google Calendar와 메일에 반영하고,
 * 매일 시작되는 연차를 지정된 Slack 채널에 알립니다.
 * 연차 계산과 승인 판단은 하지 않으며, 서명된 요청만 처리합니다.
 */
function doPost(e) {
  try {
    const envelope = JSON.parse(e.postData.contents);
    const data = verifyAndParseRequest(envelope);
    validateRequestData(data);

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const result = data.action === 'CANCEL'
        ? {
            calendar: runOperation(function () {
              return deleteCalendarEvent(data);
            }),
          }
        : {
            calendar: runOperation(function () {
              return upsertCalendarEvent(data);
            }),
            email: runOperation(function () {
              return sendApprovalEmailOnce(data);
            }),
          };

      return jsonResponse({
        ok: Object.keys(result).every(function (key) {
          return result[key].ok;
        }),
        result: result,
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return jsonResponse({
      ok: false,
      error: error && error.message ? error.message : 'Apps Script 처리 중 오류가 발생했습니다.',
    });
  }
}

function doGet() {
  return jsonResponse({
    ok: true,
    service: 'safeai-vacation-google-integration',
  });
}

/**
 * 배포 전에 편집기에서 한 번 실행해 Calendar, Mail, Slack 호출 권한을 승인합니다.
 */
function authorizeServices() {
  const calendarId = requiredProperty('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) throw new Error('CALENDAR_ID에 해당하는 캘린더를 찾을 수 없습니다.');
  MailApp.getRemainingDailyQuota();
  validateSlackConnection();
  ScriptApp.getProjectTriggers();
  console.log('Calendar, Mail, Slack 호출과 트리거 관리 권한이 확인되었습니다.');
}

/**
 * 매일 오전 9시대에 실행되는 연차 시작 알림 트리거를 설치합니다.
 * SLACK_DAILY_NOTICE_HOUR 속성으로 실행 시간대(0~23시)를 변경할 수 있습니다.
 */
function installDailyLeaveNotificationTrigger() {
  const handler = 'sendTodayLeaveNotifications';
  const configuredHour = PropertiesService
    .getScriptProperties()
    .getProperty('SLACK_DAILY_NOTICE_HOUR') || '9';
  const hour = Number(configuredHour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('SLACK_DAILY_NOTICE_HOUR는 0부터 23 사이의 정수여야 합니다.');
  }

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const trigger = ScriptApp
    .newTrigger(handler)
    .timeBased()
    .atHour(hour)
    .everyDays(1)
    .inTimezone('Asia/Seoul')
    .create();
  console.log('연차 시작 알림 트리거를 설치했습니다: ' + trigger.getUniqueId());
}

/**
 * 오늘 시작하는 연차를 찾아 지정된 Slack 채널에 한 번씩 알립니다.
 * 트리거뿐 아니라 편집기에서 직접 실행해 테스트할 수도 있습니다.
 */
function sendTodayLeaveNotifications() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const calendar = CalendarApp.getCalendarById(requiredProperty('CALENDAR_ID'));
    if (!calendar) throw new Error('설정된 Google Calendar를 찾을 수 없습니다.');

    const timeZone = 'Asia/Seoul';
    const today = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    const todayDate = parseDate(today);
    const stateKey = 'SLACK_START_NOTICES_' + today;
    const sentRequestIds = parseStringArray(properties.getProperty(stateKey));

    calendar.getEventsForDay(todayDate).forEach(function (event) {
      if (!event.isAllDayEvent()) return;
      const eventStartDate = Utilities.formatDate(
        event.getAllDayStartDate(),
        timeZone,
        'yyyy-MM-dd'
      );
      if (eventStartDate !== today) return;

      const requestId = event.getTag('leaveRequestId');
      if (!requestId || sentRequestIds.indexOf(requestId) >= 0) return;

      const applicantName = event.getTag('applicantName')
        || event.getTitle().split(' · ')[0].trim();
      const startDate = event.getTag('leaveStartDate') || eventStartDate;
      const endDate = event.getTag('leaveEndDate') || inclusiveAllDayEndDate(event, timeZone);
      const message = [
        applicantName + '님이 연차를 사용했습니다.',
        '기간: ' + startDate + ' ~ ' + endDate,
      ].join('\n');

      postSlackChannelMessage(message);
      sentRequestIds.push(requestId);
      properties.setProperty(stateKey, JSON.stringify(sentRequestIds));
    });

    deleteExpiredSlackNoticeState(properties, todayDate);
    console.log('오늘 시작하는 연차 알림 처리를 완료했습니다: ' + sentRequestIds.length + '건');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 실제 설정된 채널에 테스트 메시지를 한 번 보냅니다.
 */
function testSlackChannelNotification() {
  validateSlackConnection();
  postSlackChannelMessage('연차 시작 알림 연결 테스트입니다.');
}

function verifyAndParseRequest(envelope) {
  if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') {
    throw new Error('서명된 요청 데이터가 없습니다.');
  }

  const secret = requiredProperty('INTEGRATION_SHARED_SECRET');
  const expectedSignature = bytesToHex(
    Utilities.computeHmacSha256Signature(
      envelope.payload,
      secret,
      Utilities.Charset.UTF_8
    )
  );
  if (!safeEqual(expectedSignature, envelope.signature)) {
    throw new Error('요청 서명이 올바르지 않습니다.');
  }

  const data = JSON.parse(envelope.payload);
  const timestamp = Number(data.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    throw new Error('요청 시간이 만료되었습니다.');
  }
  return data;
}

function validateRequestData(data) {
  if (data.action !== 'APPROVE' && data.action !== 'CANCEL') {
    throw new Error('지원하지 않는 연동 작업입니다.');
  }
  const requiredStrings = [
    'requestId',
    'applicantName',
    'startDate',
    'endDate',
    'leaveType',
    'reason',
  ];
  requiredStrings.forEach(function (key) {
    if (typeof data[key] !== 'string' || !data[key].trim()) {
      throw new Error(key + ' 값이 필요합니다.');
    }
  });

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (
    !datePattern.test(data.startDate)
    || !datePattern.test(data.endDate)
    || data.startDate > data.endDate
  ) {
    throw new Error('연차 사용 기간이 올바르지 않습니다.');
  }
  if (data.requestId.length > 200 || data.applicantName.length > 100 || data.reason.length > 500) {
    throw new Error('요청 데이터의 길이가 허용 범위를 초과했습니다.');
  }
}

function upsertCalendarEvent(data) {
  const properties = PropertiesService.getScriptProperties();
  const calendar = CalendarApp.getCalendarById(requiredProperty('CALENDAR_ID'));
  if (!calendar) throw new Error('설정된 Google Calendar를 찾을 수 없습니다.');

  const startDate = parseDate(data.startDate);
  const endDateExclusive = parseDate(data.endDate);
  endDateExclusive.setDate(endDateExclusive.getDate() + 1);

  const stateKey = integrationStateKey('CALENDAR_EVENT', data.requestId);
  const savedEventId = properties.getProperty(stateKey);
  let event = savedEventId ? calendar.getEventById(savedEventId) : null;

  if (!event) {
    event = calendar
      .getEvents(startDate, endDateExclusive)
      .find(function (candidate) {
        return candidate.getTag('leaveRequestId') === data.requestId;
      }) || null;
  }

  const title = data.applicantName + ' · ' + data.leaveType;
  if (event) {
    event
      .setTitle(title)
      .setAllDayDates(startDate, endDateExclusive)
      .setTag('leaveRequestId', data.requestId)
      .setTag('applicantName', data.applicantName)
      .setTag('leaveStartDate', data.startDate)
      .setTag('leaveEndDate', data.endDate);
    properties.setProperty(stateKey, event.getId());
    return {
      ok: true,
      created: false,
      eventId: event.getId(),
    };
  }

  event = calendar.createAllDayEvent(title, startDate, endDateExclusive);
  event
    .setTag('leaveRequestId', data.requestId)
    .setTag('applicantName', data.applicantName)
    .setTag('leaveStartDate', data.startDate)
    .setTag('leaveEndDate', data.endDate);
  properties.setProperty(stateKey, event.getId());
  return {
    ok: true,
    created: true,
    eventId: event.getId(),
  };
}

function deleteCalendarEvent(data) {
  const properties = PropertiesService.getScriptProperties();
  const calendar = CalendarApp.getCalendarById(requiredProperty('CALENDAR_ID'));
  if (!calendar) throw new Error('설정된 Google Calendar를 찾을 수 없습니다.');

  const stateKey = integrationStateKey('CALENDAR_EVENT', data.requestId);
  const savedEventId = properties.getProperty(stateKey);
  let event = savedEventId ? calendar.getEventById(savedEventId) : null;

  if (!event) {
    const startDate = parseDate(data.startDate);
    const endDateExclusive = parseDate(data.endDate);
    endDateExclusive.setDate(endDateExclusive.getDate() + 1);
    event = calendar
      .getEvents(startDate, endDateExclusive)
      .find(function (candidate) {
        return candidate.getTag('leaveRequestId') === data.requestId;
      }) || null;
  }

  if (!event) {
    properties.deleteProperty(stateKey);
    return {
      ok: true,
      deleted: false,
      alreadyDeleted: true,
    };
  }

  const eventId = event.getId();
  event.deleteEvent();
  properties.deleteProperty(stateKey);
  return {
    ok: true,
    deleted: true,
    eventId: eventId,
  };
}

function sendApprovalEmailOnce(data) {
  const properties = PropertiesService.getScriptProperties();
  const stateKey = integrationStateKey('MAIL_SENT', data.requestId);
  const recipients = requiredProperty('MAIL_RECIPIENTS');

  if (properties.getProperty(stateKey)) {
    return {
      ok: true,
      sent: false,
      duplicate: true,
    };
  }

  const period = data.startDate === data.endDate
    ? data.startDate
    : data.startDate + ' ~ ' + data.endDate;
  const body = [
    '연차 사용이 승인되었습니다.',
    '',
    '신청자: ' + data.applicantName,
    '기간: ' + period,
    '연차 종류: ' + data.leaveType,
    '사유: ' + data.reason,
  ].join('\n');

  MailApp.sendEmail({
    to: recipients,
    subject: '[연차 승인] ' + data.applicantName + ' · ' + period,
    body: body,
    name: 'SafeAI 연차봇',
    noReply: true,
  });
  properties.setProperty(stateKey, new Date().toISOString());
  return {
    ok: true,
    sent: true,
  };
}

function validateSlackConnection() {
  const response = slackApi('auth.test', {});
  if (!response.team_id) throw new Error('Slack 워크스페이스 정보를 확인하지 못했습니다.');
  return response;
}

function postSlackChannelMessage(text) {
  const response = slackApi('chat.postMessage', {
    channel: requiredProperty('SLACK_NOTIFICATION_CHANNEL_ID'),
    text: text,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!response.ts) throw new Error('Slack 메시지 식별값을 받지 못했습니다.');
  return response;
}

function slackApi(method, payload) {
  const response = UrlFetchApp.fetch('https://slack.com/api/' + method, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: {
      Authorization: 'Bearer ' + requiredProperty('SLACK_BOT_TOKEN'),
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('Slack 응답 형식이 올바르지 않습니다. HTTP ' + statusCode);
  }
  if (!result.ok) {
    throw new Error('Slack API 오류: ' + (result.error || 'HTTP ' + statusCode));
  }
  return result;
}

function inclusiveAllDayEndDate(event, timeZone) {
  const endDate = event.getAllDayEndDate();
  endDate.setDate(endDate.getDate() - 1);
  return Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd');
}

function parseStringArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(function (item) {
          return typeof item === 'string';
        })
      : [];
  } catch (error) {
    console.warn('Slack 알림 상태값을 읽지 못해 초기화합니다.');
    return [];
  }
}

function deleteExpiredSlackNoticeState(properties, todayDate) {
  const expirationDate = new Date(todayDate);
  expirationDate.setDate(expirationDate.getDate() - 31);
  const expirationKey = Utilities.formatDate(expirationDate, 'Asia/Seoul', 'yyyy-MM-dd');
  const prefix = 'SLACK_START_NOTICES_';
  const allProperties = properties.getProperties();
  Object.keys(allProperties).forEach(function (key) {
    if (key.indexOf(prefix) !== 0) return;
    const date = key.slice(prefix.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < expirationKey) {
      properties.deleteProperty(key);
    }
  });
}

function runOperation(callback) {
  try {
    return callback();
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      error: error && error.message ? error.message : '처리 중 오류가 발생했습니다.',
    };
  }
}

function requiredProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(name + ' 스크립트 속성이 필요합니다.');
  return value;
}

function integrationStateKey(prefix, requestId) {
  return prefix + '_' + digestHex(requestId);
}

function digestHex(value) {
  return bytesToHex(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      value,
      Utilities.Charset.UTF_8
    )
  );
}

function bytesToHex(bytes) {
  return bytes
    .map(function (value) {
      return ('0' + (value & 0xff).toString(16)).slice(-2);
    })
    .join('');
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function parseDate(value) {
  const parts = value.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
