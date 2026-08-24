# 테니스 잡아줘

강일테니스장 / 명일테니스장의 예약현황을 정상 Chromium 브라우저 세션으로 확인하고, 원하는 날짜와 시간대에 빈자리가 생기면 Telegram으로 알려주는 개인용 MVP입니다.

이 프로젝트는 자동 예약, 자동 클릭, 자동 결제, CAPTCHA 우회, WebGate 토큰 위조를 구현하지 않습니다. 로그인한 사용자가 브라우저에서 예약현황을 확인하는 흐름까지만 자동화합니다.

## 실행 준비

```bash
npm install
npx playwright install chromium
copy .env.example .env
```

`.env`에 실제 값을 입력합니다.

필요한 환경변수:

```env
GANGDONG_USER_ID=
GANGDONG_USER_PASSWORD=
OLYMPIC_USER_ID=
OLYMPIC_USER_PASSWORD=
SONGPA_USER_ID=
SONGPA_USER_PASSWORD=
ENABLE_OLYMPIC_PROVIDER=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_BOT_USERNAME=
ADMIN_API_TOKEN=
LEGACY_OWNER_USER_ID=
HEADLESS=true
ENABLE_TEST_TOOLS=false
CHECK_INTERVAL_MINUTES=10
GANGDONG_POLLING_MINUTES=5
SONGPA_POLLING_MINUTES=5
OLYMPIC_POLLING_MINUTES=5
```

## 실행

```bash
npm start
```

웹 UI는 기본적으로 `http://localhost:3000`에서 열립니다.

기술검증만 실행하려면:

```bash
npm run check
npm run diagnose:headless
npm run diagnose:songpa
```

Railway에서 Olympic monitoring이 실행 중일 때 동일 계정으로 로컬 `diagnose:olympic`을 동시에 실행하지 마십시오. 올림픽공원 자동 감시가 필요 없는 로컬 개발환경에서는 `ENABLE_OLYMPIC_PROVIDER=false`로 두면 scheduler/manual 자동 조회에서 Olympic provider를 호출하지 않습니다. 단, `npm run diagnose:olympic`은 명시적인 진단 명령이므로 이 값과 별도로 실행할 수 있습니다.

서버 실행 중에는 등록된 활성 알림 조건을 기준으로 provider별 조회주기에 맞춰 자동 조회합니다. 기본값은 강동, 송파, 올림픽 모두 5분입니다.

## 동작 방식

1. Playwright Chromium persistent context를 실행합니다.
2. 로그인 상태를 확인합니다.
3. 로그인되어 있지 않으면 `.env` 계정으로 정상 로그인합니다.
4. 강일/명일 예약현황 페이지로 이동합니다.
5. WebGate 보호 페이지나 로그인 페이지가 아닌 실제 예약현황 DOM인지 검사합니다.
6. 날짜, 시간대, 예약가능 여부, 가능 코트 수를 표준 데이터로 정규화합니다.
7. provider별 조회주기에 맞춰 각 테니스장 현황을 조회하고 저장된 알림 조건과 비교합니다.
8. 예약완료에서 예약가능으로 바뀌었거나, 조건 등록 시 이미 예약가능이면 Telegram으로 1회 알림을 보냅니다.

## 데이터와 세션

- 알림 조건과 마지막 상태: `data/state.json`
- Chromium 세션: `sessions/gangdong-profile/`
- Headless storage state: `sessions/gangdong-storage-state.json`
- Olympic Chromium 세션: `sessions/olympic-profile/`

두 경로는 `.gitignore`와 ZIP 제외 대상입니다.

클라우드에서는 `DATA_DIR`, `SESSION_DIR` 또는 Railway Volume을 사용합니다. Railway Volume이 연결되어 있으면 `RAILWAY_VOLUME_MOUNT_PATH`를 기준으로 저장 경로를 잡을 수 있고, Docker 기본값은 `/data/data`, `/data/sessions`입니다.

저장되는 알림 조건은 `enabled` 값을 포함하며, UI에서 삭제하거나 켜고 끌 수 있습니다. 마지막 예약상태도 함께 저장해 `예약완료 → 예약가능` 변화에서만 알림을 보내고, 같은 빈자리가 계속 유지될 때는 중복 전송하지 않습니다.

## Telegram 설정

1. Telegram에서 `BotFather`로 봇을 만들고 Bot Token을 받습니다.
2. 봇에게 메시지를 한 번 보냅니다.
3. BotFather에서 봇 username을 확인합니다.
4. `.env`의 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`에 입력합니다.
5. Closed Beta 사용자별 알림은 각 사용자가 웹에서 Telegram 연결을 완료하면 저장되는 `telegramChatId`로 발송됩니다. `TELEGRAM_CHAT_ID`는 수동 테스트용 fallback입니다.

Closed Beta Telegram 연결을 위해 Railway 배포 URL 기준 webhook을 등록합니다.

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<railway-domain>/api/telegram/webhook"
```

## Closed Beta 운영

이 서비스는 회원가입 없이 초대코드로만 진입합니다. 일반 사용자는 전체 사용자 목록이나 전체 알림 조건을 볼 수 없고, 자기 알림 조건만 조회/수정/삭제할 수 있습니다.

초대코드 생성:

```bash
npm run create-invite
```

특정 코드를 직접 만들려면:

```bash
npm run create-invite -- TENNIS-ABCD-1234
```

사용자 비활성화:

```bash
npm run disable-user -- <userId>
```

다시 활성화:

```bash
npm run disable-user -- <userId> enable
```

기존 `state.json`에 `userId`가 없는 legacy watch가 있으면 삭제하지 않습니다. 기존 watch를 특정 관리자 사용자에게 귀속하려면 먼저 초대코드로 관리자 사용자를 만들고 `state.json`의 사용자 id를 확인한 뒤 Railway Variables에 다음 값을 설정하고 재시작합니다.

```env
LEGACY_OWNER_USER_ID=<admin-user-id>
```

일반 사용자를 초대하는 절차:

1. 운영자가 `npm run create-invite`로 초대코드를 생성합니다.
2. 지인에게 초대코드를 전달합니다.
3. 지인이 웹에 접속해 초대코드와 별명을 입력합니다.
4. 지인이 `텔레그램 연결하기`를 눌러 Telegram 봇을 엽니다.
5. Telegram에서 `/start <1회성토큰>`이 전송되면 서버가 해당 chat id를 사용자와 연결합니다.
6. 웹에서 코트, 날짜, 시간대를 선택해 알림 조건을 등록합니다.
7. 공통 scheduler가 다음 조회 시점에 한 번 예약현황을 조회하고, 조건에 맞는 사용자에게만 Telegram을 보냅니다.

같은 사용자가 PC와 모바일을 함께 쓰려면 초대코드를 다시 쓰지 않습니다. 이미 로그인된 기기에서 `기기 연결 코드 만들기`를 누르고, 새 기기 초기 화면의 `기존 계정 연결하기`에 표시된 6자리 코드를 입력합니다. 기기 연결 코드는 기존 사용자에 새 브라우저 session만 추가하며, 10분 동안 1회만 사용할 수 있습니다.

초대코드와 기기 연결 코드의 차이:

- 초대코드: 운영자가 발급하며 새 user를 처음 생성합니다.
- 기기 연결 코드: 기존 사용자가 발급하며 같은 user에 새 session을 추가합니다.

Telegram 연결만 확인하려면:

```bash
npm run telegram:test
```

실제 예약현황을 조회해 예약가능 슬롯이 있을 때만 알림을 보내려면:

```bash
npm run alert:test
```

실제 빈자리가 없을 때 메시지 포맷만 확인하려면:

```bash
npm run alert:test:mock
```

## 테스트

```bash
npm test
```

테스트는 실제 사이트에 로그인하지 않고 샘플 HTML 파싱과 상태변화 알림 로직을 검증합니다.

## Docker

```bash
docker build -t tennis-jabajwo .
docker run --env-file .env -p 3000:3000 tennis-jabajwo
```

컨테이너 안에서는 Playwright 공식 이미지를 사용하며 `HEADLESS=true`로 Chromium을 실행합니다. Health check endpoint는 `/health`입니다.

## Railway 배포

Railway는 루트의 `Dockerfile`과 `railway.json`을 사용합니다.

서비스 변수에 다음 값을 설정합니다.

```env
GANGDONG_USER_ID=
GANGDONG_USER_PASSWORD=
OLYMPIC_USER_ID=
OLYMPIC_USER_PASSWORD=
SONGPA_USER_ID=
SONGPA_USER_PASSWORD=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_BOT_USERNAME=
ADMIN_API_TOKEN=
LEGACY_OWNER_USER_ID=
HEADLESS=true
ENABLE_TEST_TOOLS=false
ENABLE_OLYMPIC_PROVIDER=true
CHECK_INTERVAL_MINUTES=10
GANGDONG_POLLING_MINUTES=5
SONGPA_POLLING_MINUTES=5
OLYMPIC_POLLING_MINUTES=5
RAILWAY_RUN_UID=0
```

조회주기는 Railway의 `tennis` 서비스 → `Variables`에서 provider별로 조정합니다.

```env
GANGDONG_POLLING_MINUTES=5
SONGPA_POLLING_MINUTES=5
OLYMPIC_POLLING_MINUTES=5
```

이후 조회주기를 변경하려면 코드를 수정하지 말고 Railway Variables에서 숫자만 변경합니다. 예: `OLYMPIC_POLLING_MINUTES=10`. 환경변수 수정 후 Railway 서비스가 재시작되면 새 값이 적용됩니다. provider 전용 변수가 없으면 기존 `CHECK_INTERVAL_MINUTES`를 fallback으로 사용하고, 둘 다 없거나 잘못된 값이면 기본 5분을 사용합니다.

송파구시설관리공단 연동을 사용하려면 Railway Variables에 다음 값을 추가하세요.

```text
SONGPA_USER_ID = 실제 송파 아이디
SONGPA_USER_PASSWORD = 실제 송파 비밀번호
```

기존 `GANGDONG_USER_ID`, `GANGDONG_USER_PASSWORD`, `OLYMPIC_USER_ID`, `OLYMPIC_USER_PASSWORD`와 독립적으로 관리합니다.

알림 조건과 세션을 유지하려면 Railway Volume을 서비스에 연결하고 mount path를 `/data`로 설정합니다. Docker 기본 저장 경로가 `/data/data`, `/data/sessions`이므로 이 Volume에 상태와 세션이 저장됩니다.

올림픽공원 계정을 사용하는 동안 Railway Replica는 `1`로 유지하세요. 동일 서비스를 여러 replica로 scale-out하면 같은 계정으로 여러 프로세스가 동시에 로그인할 수 있습니다. 운영 Railway에는 `ENABLE_OLYMPIC_PROVIDER=true`를 설정하고, 동일 계정으로 로컬 진단을 병행하지 않는 구성을 권장합니다.

Railway 서비스 설정에서 Public Networking의 도메인을 생성하면 기존 웹 UI에 접속할 수 있습니다. Healthcheck Path는 `/health`입니다.

클라우드 서버에서는 장기 실행 Chromium이 가능한 Railway, Render, Fly.io, VPS 같은 환경을 사용하세요. Vercel Serverless 함수처럼 브라우저를 오래 띄우는 환경은 이 용도에 맞지 않습니다.
