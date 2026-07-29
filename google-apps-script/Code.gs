/**
 * 연차 웹앱에서 승인된 신청을 받아 Google Calendar와 메일에 반영합니다.
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
      const result = {
        calendar: runOperation(function () {
          return upsertCalendarEvent(data);
        }),
        email: runOperation(function () {
          return sendApprovalEmailOnce(data);
        }),
      };

      return jsonResponse({
        ok: result.calendar.ok && result.email.ok,
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
 * 배포 전에 편집기에서 한 번 실행해 Calendar와 Mail 권한을 승인합니다.
 */
function authorizeServices() {
  const calendarId = requiredProperty('CALENDAR_ID');
  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) throw new Error('CALENDAR_ID에 해당하는 캘린더를 찾을 수 없습니다.');
  MailApp.getRemainingDailyQuota();
  console.log('Calendar와 Mail 권한이 확인되었습니다.');
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
      .setTag('leaveRequestId', data.requestId);
    properties.setProperty(stateKey, event.getId());
    return {
      ok: true,
      created: false,
      eventId: event.getId(),
    };
  }

  event = calendar.createAllDayEvent(title, startDate, endDateExclusive);
  event.setTag('leaveRequestId', data.requestId);
  properties.setProperty(stateKey, event.getId());
  return {
    ok: true,
    created: true,
    eventId: event.getId(),
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
    name: '연차 관리 시스템',
  });
  properties.setProperty(stateKey, new Date().toISOString());
  return {
    ok: true,
    sent: true,
  };
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
