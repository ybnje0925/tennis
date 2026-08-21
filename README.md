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
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
HEADLESS=true
ENABLE_TEST_TOOLS=false
CHECK_INTERVAL_MINUTES=10
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
```

서버 실행 중에는 등록된 알림 조건을 기준으로 10분마다 자동 조회합니다. 같은 주기에 강일/명일 예약현황은 각각 1회만 조회하고, 가져온 결과를 모든 조건과 비교합니다.

## 동작 방식

1. Playwright Chromium persistent context를 실행합니다.
2. 로그인 상태를 확인합니다.
3. 로그인되어 있지 않으면 `.env` 계정으로 정상 로그인합니다.
4. 강일/명일 예약현황 페이지로 이동합니다.
5. WebGate 보호 페이지나 로그인 페이지가 아닌 실제 예약현황 DOM인지 검사합니다.
6. 날짜, 시간대, 예약가능 여부, 가능 코트 수를 표준 데이터로 정규화합니다.
7. 10분마다 각 테니스장 현황을 1회씩 조회하고 저장된 알림 조건과 비교합니다.
8. 예약완료에서 예약가능으로 바뀌었거나, 조건 등록 시 이미 예약가능이면 Telegram으로 1회 알림을 보냅니다.

## 데이터와 세션

- 알림 조건과 마지막 상태: `data/state.json`
- Chromium 세션: `sessions/gangdong-profile/`
- Headless storage state: `sessions/gangdong-storage-state.json`

두 경로는 `.gitignore`와 ZIP 제외 대상입니다.

클라우드에서는 `DATA_DIR`, `SESSION_DIR` 또는 Railway Volume을 사용합니다. Railway Volume이 연결되어 있으면 `RAILWAY_VOLUME_MOUNT_PATH`를 기준으로 저장 경로를 잡을 수 있고, Docker 기본값은 `/data/data`, `/data/sessions`입니다.

저장되는 알림 조건은 `enabled` 값을 포함하며, UI에서 삭제하거나 켜고 끌 수 있습니다. 마지막 예약상태도 함께 저장해 `예약완료 → 예약가능` 변화에서만 알림을 보내고, 같은 빈자리가 계속 유지될 때는 중복 전송하지 않습니다.

## Telegram 설정

1. Telegram에서 `BotFather`로 봇을 만들고 Bot Token을 받습니다.
2. 봇에게 메시지를 한 번 보냅니다.
3. `https://api.telegram.org/bot<토큰>/getUpdates`로 `chat.id`를 확인합니다.
4. `.env`의 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`에 입력합니다.

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
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
HEADLESS=true
ENABLE_TEST_TOOLS=false
CHECK_INTERVAL_MINUTES=10
RAILWAY_RUN_UID=0
```

알림 조건과 세션을 유지하려면 Railway Volume을 서비스에 연결하고 mount path를 `/data`로 설정합니다. Docker 기본 저장 경로가 `/data/data`, `/data/sessions`이므로 이 Volume에 상태와 세션이 저장됩니다.

Railway 서비스 설정에서 Public Networking의 도메인을 생성하면 기존 웹 UI에 접속할 수 있습니다. Healthcheck Path는 `/health`입니다.

클라우드 서버에서는 장기 실행 Chromium이 가능한 Railway, Render, Fly.io, VPS 같은 환경을 사용하세요. Vercel Serverless 함수처럼 브라우저를 오래 띄우는 환경은 이 용도에 맞지 않습니다.
