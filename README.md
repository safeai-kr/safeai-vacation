# 연차 관리 시스템

회사 Google 계정으로 로그인해 연차 현황, 신청, 담당자 승인, 직원과 팀을 관리하는 내부 웹앱입니다. 웹앱과 API는 Next.js/Vercel에서 실행하고 데이터는 Firebase Cloud Firestore에 저장합니다.

## 주요 기능

- `safeai.kr` Google 계정 로그인
- 개인 및 전체 직원 잔여 연차 확인
- 정기 연차·포상휴가 및 오전·오후 반차 신청
- 관리자 또는 팀장의 포상 연차 지급과 지급 건별 61일 유효기간 관리
- 잘못 지급한 포상 연차 수정 및 미사용 잔여 회수
- 입사일 기준 연차 자동 부여와 시스템 도입 전 사용분 반영
- 팀별 담당 팀장 자동 지정
- 직원별 직접 승인자 예외 지정
- 대표 신청 자동 승인
- 담당 승인자만 상세 사유 확인 및 승인·반려
- 대기 신청 취소, 사용 시작 전 승인 신청 취소 및 잔여 휴가 복구
- 사용 시작일 당일 이후 관리자 신청 상태 취소
- 대표와 별도 담당자의 직원·팀 관리
- 재직·휴직·퇴사 등 직원 상태 관리
- 승인·반려·취소 이력과 실패 로그 확인 처리
- 정기·포상휴가 잔액 부족 신청 차단
- Firestore 감사 기록 저장
- Firebase 없이 화면을 확인하는 데모 모드

## 로컬 화면 확인

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

`LEAVE_DEMO_MODE=true`에서는 실제 Firebase에 저장하지 않습니다. `npm run dev`로 실행한 로컬 데모 화면의 헤더에는 `관리자`, `팀장`, `일반 직원` 역할 선택기가 표시됩니다. 선택한 역할에 따라 사용 가능한 탭, 승인 대상, 포상 연차 지급 범위와 개인 잔여 연차가 함께 변경됩니다. 이 역할 선택기는 개발 서버에서만 활성화되며 Vercel을 포함한 운영 빌드에는 표시되지 않습니다.

로컬에서 실제 Firebase를 사용하면서 Google 로그인을 생략하려면 다음 값을 사용합니다. 이 우회는 개발 서버에서만 작동하며 운영 빌드에서는 무시됩니다.

```dotenv
LEAVE_DEMO_MODE=false
LOCAL_AUTH_BYPASS=true
LOCAL_AUTH_EMAIL=~~@safeai.kr
```

## Firebase 설정

1. Firebase Console에서 프로젝트를 생성합니다.
2. Cloud Firestore 데이터베이스를 생성합니다.
3. `FIREBASE_PROJECT_ID`에 Firebase 프로젝트 ID를 등록합니다.
4. 로컬은 Google Cloud CLI의 Application Default Credentials, Vercel은 OIDC Workload Identity Federation으로 인증합니다.
5. `FIREBASE_ADMIN_EMAILS`에 최초 직원 관리 권한을 가질 계정을 등록합니다. 이 값은 직책과 무관하게 관리자 권한만 부여합니다.
6. 정책과 컬렉션 메타데이터를 초기화합니다.

```dotenv
FIREBASE_PROJECT_ID=~~
FIREBASE_ADMIN_EMAILS=~~@safeai.kr
```

```bash
cd web
npm run setup:firebase
```

Firestore는 브라우저에서 직접 읽지 않고 Vercel 서버 API에서만 접근합니다. Firestore Rules는 직접 접근을 차단하도록 설정합니다.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

연결 후 대표 또는 별도 담당자 계정으로 로그인하여 `직원 관리` 탭에서 다음 순서로 등록합니다. 팀 승인자는 등록이 완료된 활성 사내 직원만 지정할 수 있습니다.

1. 대표를 직책 `대표`로 등록하고 필요한 권한을 별도로 선택
2. 각 팀장을 등록하고 직접 승인자를 대표로 지정
3. 플랫폼팀, AI Research팀, 전략기획팀, 경영지원팀의 팀 승인자를 등록된 팀장으로 설정
4. 일반 직원을 소속 팀에 등록
5. 대표가 직접 승인할 직원은 직접 승인자를 대표로 지정

## Google 로그인 설정

Google Cloud에서 OAuth 2.0 Web Application을 생성하고 콜백 URL을 등록합니다.

- 로컬: `http://localhost:3456/api/auth/callback/google`
- 운영: `https://YOUR_DOMAIN/api/auth/callback/google`

```dotenv
LEAVE_DEMO_MODE=false
GOOGLE_AUTH_DOMAIN=safeai.kr
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
AUTH_SECRET=충분히-긴-임의의-문자열
FIREBASE_ADMIN_EMAILS=...
FIREBASE_PROJECT_ID=~~
```

`AUTH_SECRET` 생성:

```bash
openssl rand -hex 32
```

## 승인 규칙

- 일반 직원: 소속 팀의 팀장이 승인
- 직접 승인자가 지정된 직원: 지정된 사람이 승인
- 팀장: 직접 승인자로 설정된 대표가 승인
- 대표: 신청 즉시 자동 승인
- 직책: 대표, 팀장, 직원 중 하나로 승인 경로를 결정
- 권한: 관리자, 일반 중 하나로 직원·팀 관리 화면 접근 여부를 결정
- `FIREBASE_ADMIN_EMAILS` 계정은 등록이 끝나기 전 초기 설정에만 관리자 권한을 제공하며, 등록 완료 후에는 직원 정보의 `권한` 값이 적용됨
- 팀 승인자와 직접 승인자는 등록 완료·재직 상태인 사내 직원만 지정 가능
- 휴직·퇴사·비활성 직원은 신청, 승인, 포상 지급 대상에서 제외
- 팀 승인자, 직접 승인자 또는 승인 대기 신청에 연결된 직원은 연결을 정리하기 전까지 비활성화할 수 없음
- `LOCAL_AUTH_BYPASS=true`인 로컬 개발 환경에서는 현재 테스트 설정을 위해 팀 승인자 경로의 본인 승인을 허용하지만, 운영 환경에서는 대표 외 본인 승인이 차단됨

## 취소 규칙

- 승인 대기 신청은 신청자가 즉시 취소할 수 있으며 예약된 정기·포상휴가가 해제됨
- 승인된 신청은 첫 실제 사용일 전까지 신청자가 취소할 수 있으며 차감된 휴가가 복구됨
- 첫 실제 사용일 당일 이후에는 관리자만 신청 상태를 취소할 수 있고 기존 사용량과 잔여 휴가는 유지됨
- 여러 날짜를 한 번에 신청한 경우 일부 날짜만이 아니라 신청 전체를 취소함
- 취소 처리자, 처리 시각, 원래 상태와 잔여 복구 여부를 Firestore 감사 기록에 저장함

정기 연차는 입사일부터 현재까지의 자동 부여 원장에 시스템 도입 전 사용분과 승인된 사용분을 반영하고, 승인 대기 신청을 예약 차감해 계산합니다. 월차가 발생하는 기간에는 미사용분이 누적되지만, 첫 비례 연차와 이후 매년 1월 1일 연차가 새로 부여될 때는 이전 미사용 정기 연차가 모두 소멸합니다. 신청 기간의 주말은 서버에서 자동 제외합니다. 포상휴가는 지급 건마다 `지급일 + 61일`까지 유효하며 실제 사용일에 유효한 건만 만료일 순으로 배정합니다.

포상 연차 수정 시 이미 사용했거나 승인 대기로 예약된 일수보다 지급량을 줄일 수 없고, 사용일을 변경된 유효기간 밖으로 이동시킬 수 없습니다. 오래 열린 수정 화면의 값으로 다른 관리자의 변경을 덮어쓰지 못하도록 지급 건 버전도 확인합니다. `잔여 회수`는 사용·예약분을 유지하고 아직 배정되지 않은 일수만 회수하며, 이미 만료된 지급 건은 별도 회수하지 않습니다. 승인·반려·취소 성공 기록은 감사 로그에, 서버 처리 실패는 별도 실패 로그에 저장되며 관리자가 `기록 관리` 탭에서 확인 처리할 수 있습니다.

## Slack·Google Calendar·Gmail 연동

연차 신청이 등록되면 담당 승인자에게 Slack 개인 메시지를 보내고, 메시지의 `승인`·`반려` 버튼으로 기존 웹 승인 로직을 실행합니다. 버튼을 누르면 원본 메시지의 버튼을 제거하고 `처리 중` 상태를 먼저 표시한 뒤, 완료되면 `승인 완료` 또는 `반려 완료`로 갱신합니다. 처리 자체가 실패하면 `처리 실패` 상태와 확인 메시지를 표시합니다. 승인된 신청은 Google Calendar에 종일 일정 하나로 등록하고 지정된 이메일로 승인 내용을 전송합니다. 승인된 신청을 취소하면 신청 ID로 기존 캘린더 일정을 찾아 삭제하며 취소 메일은 발송하지 않습니다. 승인 대기 상태에서 취소한 신청은 외부 연동을 호출하지 않습니다.

데모 모드에서는 Firebase 신청 데이터와 잔액을 변경하지 않습니다. 신청 화면에서 입력한 내용은 Slack 메시지의 서명된 버튼 데이터로 전달되며, 데모 수신자는 `paradise@safeai.kr`로 설정합니다. Slack 승인 버튼은 배포된 HTTPS 주소를 호출해야 하므로 Vercel Preview 또는 Production 환경에서 테스트합니다.

### Slack App 설정

기존 Slack App의 `OAuth & Permissions`에서 Bot Token Scopes를 확인합니다.

- `chat:write`: 승인 요청 메시지 전송 및 상태 변경
- `im:write`: 승인자와 개인 메시지 채널 열기
- `users:read.email`: `SLACK_DEMO_USER_ID`를 비우고 이메일로 사용자를 찾을 때만 필요

권한을 추가했다면 App을 워크스페이스에 다시 설치합니다. `Interactivity & Shortcuts`를 활성화하고 Request URL을 다음과 같이 등록합니다.

```text
https://vacation.safeai.kr/api/integrations/slack/actions
```

로컬 및 Vercel에 다음 환경변수를 등록합니다.

```dotenv
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_TEAM_ID=T...
SLACK_DEMO_USER_ID=U...
LEAVE_DEMO_RECIPIENT_EMAIL=paradise@safeai.kr
```

`SLACK_BOT_TOKEN`은 Slack App의 `OAuth & Permissions`에 있는 `Bot User OAuth Token`, `SLACK_SIGNING_SECRET`은 `Basic Information`의 `App Credentials`, `SLACK_TEAM_ID`는 Slack 웹 주소 `https://app.slack.com/client/T...`의 `T...` 값입니다. `SLACK_DEMO_USER_ID`는 Slack에서 본인 프로필의 `멤버 ID 복사`로 확인합니다.

### Apps Script Calendar·메일·연차 시작 Slack 알림 설정

Google API Refresh Token 대신 Apps Script 웹앱이 배포자 권한으로 Google Calendar와 Mail을 사용합니다. Apps Script는 승인 결과만 전달받으며 Sheet와 연차 계산에는 접근하지 않습니다. 매일 오전에는 캘린더에서 당일 시작하는 연차를 찾아 지정된 Slack 채널에 알립니다.

1. 새 Apps Script 독립 프로젝트를 만듭니다.
2. [`google-apps-script/Code.gs`](google-apps-script/Code.gs)의 코드를 붙여 넣습니다.
3. 프로젝트 설정에서 `appsscript.json` 매니페스트 표시를 활성화한 뒤 [`google-apps-script/appsscript.json`](google-apps-script/appsscript.json)의 내용으로 교체합니다.
4. 프로젝트 설정의 스크립트 속성에 아래 값을 등록합니다.

```text
INTEGRATION_SHARED_SECRET = openssl rand -hex 32로 생성한 값
CALENDAR_ID = Google Calendar의 캘린더 ID
MAIL_RECIPIENTS = paradise@safeai.kr
SLACK_BOT_TOKEN = xoxb-로 시작하는 기존 Bot User OAuth Token
SLACK_NOTIFICATION_CHANNEL_ID = 알림을 받을 Slack 채널 ID
SLACK_DAILY_NOTICE_HOUR = 9
```

캘린더 ID는 Google Calendar의 `설정 및 공유 → 캘린더 통합 → 캘린더 ID`에서 확인합니다. Apps Script 소유자 계정은 해당 캘린더를 수정할 권한이 있어야 합니다. `SLACK_NOTIFICATION_CHANNEL_ID`는 Slack 채널 상세 화면에서 `채널 ID 복사`로 확인하며, 기존 봇을 해당 채널에 초대해야 합니다. `SLACK_DAILY_NOTICE_HOUR`를 생략하면 오전 9시로 설정됩니다.

Apps Script 편집기에서 `authorizeServices` 함수를 한 번 실행하고 Calendar, 메일, 외부 요청, 트리거 관리 권한을 허용합니다. `testSlackChannelNotification`을 실행해 지정 채널에 테스트 메시지가 도착하는지 확인한 다음 `installDailyLeaveNotificationTrigger`를 한 번 실행합니다. 이 함수는 기존 동일 알림 트리거를 제거하고 매일 오전 9시대에 실행되는 트리거 하나를 생성합니다. 이후 `배포 → 새 배포 → 웹 앱`에서 다음과 같이 배포합니다.

```text
다음 사용자로 실행: 나
액세스 권한이 있는 사용자: 모든 사용자
```

Vercel 서버는 Google 로그인 화면을 통과할 수 없으므로 익명 호출 가능한 웹앱으로 배포합니다. 대신 모든 요청에 5분 유효 HMAC 서명을 적용하고, Apps Script가 서명을 검증한 후에만 Calendar와 메일을 실행합니다.

배포 후 `/exec`으로 끝나는 웹앱 URL과 동일한 공유 비밀키를 Vercel에 등록합니다.

```dotenv
GOOGLE_APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/.../exec
GOOGLE_APPS_SCRIPT_SHARED_SECRET=Apps-Script의-INTEGRATION_SHARED_SECRET과-같은-값
```

캘린더에는 신청 시작일부터 종료일까지 주말을 포함한 종일 일정 하나를 만듭니다. 일정 제목은 `신청자 · 연차`, `신청자 · 오전 반차`, `신청자 · 오후 반차` 중 하나로 표시하며 정기 연차와 포상휴가는 구분하지 않습니다. 승인 메일에는 신청자, 사용 기간, 연차 종류, 상세 사유를 표시하며 Google Workspace의 `no-reply` 주소와 `SafeAI 연차봇` 표시 이름으로 발송합니다. 신청 ID를 기준으로 캘린더 중복 생성과 메일 중복 발송도 방지합니다.

연차 시작일에는 지정 채널에 다음 형식으로 신청별 메시지를 보냅니다. 같은 신청은 트리거가 재실행되어도 하루에 한 번만 전송하며, 취소되어 캘린더에서 삭제된 연차는 전송하지 않습니다.

```text
유동연님이 연차를 사용했습니다.
기간: 2026-07-20 ~ 2026-07-20
```

## Vercel 배포

Vercel 프로젝트의 Root Directory를 `web`으로 지정하고 실제 운영에서는 `LEAVE_DEMO_MODE=false`로 설정합니다.

Firebase Admin은 Production 배포에서 Vercel OIDC 토큰을 Google Cloud 단기 인증 정보로 교환합니다. Vercel의 OIDC Federation을 Team 모드로 활성화하고 다음 값을 Production 환경에만 등록합니다.

```dotenv
GCP_PROJECT_ID=safeai-vacation-b623a
GCP_PROJECT_NUMBER=숫자로-된-프로젝트-번호
GCP_SERVICE_ACCOUNT_EMAIL=Vercel용-서비스-계정-이메일
GCP_WORKLOAD_IDENTITY_POOL_ID=워크로드-아이덴티티-풀-ID
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=OIDC-공급업체-ID
```

`VERCEL_OIDC_TOKEN`은 Vercel이 요청마다 제공하므로 직접 등록하지 않습니다. OIDC 구성에서는 `FIREBASE_SERVICE_ACCOUNT_JSON`도 등록하지 않습니다. 로컬 개발은 위 GCP 환경변수를 생략하고 Google Cloud CLI의 Application Default Credentials를 계속 사용합니다.
