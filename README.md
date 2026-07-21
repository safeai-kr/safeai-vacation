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

`LEAVE_DEMO_MODE=true`에서는 실제 Firebase에 저장하지 않습니다.

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

## Vercel 배포

Vercel 프로젝트의 Root Directory를 `web`으로 지정하고 `.env.local`과 동일한 환경변수를 등록합니다. 실제 운영에서는 `LEAVE_DEMO_MODE=false`로 설정합니다.
