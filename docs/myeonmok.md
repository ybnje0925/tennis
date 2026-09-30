# 면목구립테니스장 통합 기록

## 확인한 공개 구조 (2026-09-30, Asia/Seoul)

- 대상: https://tennis.jungnangimc.or.kr/page/rent/s01.od.list.php
- 비로그인 GET 응답 200, Content-Type: text/html; charset=utf-8.
- 최초 HTML에 운영 안내표와 날짜별 예약 달력이 모두 들어 있다.
- 기준 날짜: .calendar1_yearmonth의 "오늘은 YYYY-MM-DD".
- 달력: .calendar1_table의 td / h6 (MM.DD), li (N부, 상태, 예약 수/정원).
- 공개된 것은 회차별 팀 총량이다. 코트 번호를 추정하거나 선택하지 않는다.
- 현재 공개 달력에 이전/다음 달 이동 링크나 조회 기간 입력 폼은 없다. 별도 월 조회 파라미터를 만들지 않았다.
- 실제 응답은 현재 주 일요일부터 다음 달력 주까지 연속 날짜를 제공한다. 예약 상태가 표시되지 않는 날짜는 조회 범위 밖 또는 상태 확인 불가로 처리한다. 미오픈과 휴장을 빈 셀에서 추정하지 않는다.
- li에 이용시간은 없으며 공식 운영 안내표의 이용 날짜에 해당하는 계절 열을 사용한다. li에 실제 시간이 추가되면 이를 우선하고 불일치를 표시한다.
- 공개 페이지의 일반 신청 링크는 fn_rent_odchk1, 일부 날짜는 fn_wait_rent_odchk1이다. "예약가능"이 사용자 신청 자격을 보장하지 않는다.
- 연결된 common.js와 pub.js에 달력 조회 AJAX를 발견하지 못했다. HTML이 참조한 ui.user.js는 조사 시 404였다.

## 조회에 사용하지 않은 신청 절차

인라인 스크립트에서 확인된 POST ./ajax.rent.proc.php:
mode=rent_od_chk1 또는 rent_wait_od_chk1, sct_key=2, grp_seq,
urent_d, month_display_3_s, month_display_3_e.
이는 신청 자격 확인 후 일반/대기 팀 신청 화면으로 이동하는 절차이다.
빈자리 조회에 필요하지 않아 호출하지 않았다. 로그인·신청 자격·자동 예약·결제는 수행하거나 검증하지 않았다.
알림과 화면 링크는 공개 목록 URL이다.

## 기존 구조와 통합

- VENUES/PROVIDERS 등록 및 checker의 공통 provider 잠금·오류 격리를 사용한다.
- 활성 사용자 알림 조건의 날짜를 합쳐 목록 GET 한 번으로 공유한다. 활성 조건이 없으면 요청하지 않는다.
- 공통 스케줄러는 매분 due 여부를 확인하고 시설별 기본 5분에 실행한다. 01:00~06:00 KST는 기존 절전 시간이다.
- 로컬 .env CHECK_INTERVAL_MINUTES=10은 현재 provider 스케줄러에서 사용하지 않는다. 시설별 기본 주기는 5분이며 면목은 공통 5분으로 고정 등록했다. .env.example의 혼동을 줄이기 위해 예시를 5로 맞췄다.
- HTTP 요청마다 12초 제한, 일시 네트워크 오류·429·5xx에 한 번만 재시도(750ms 대기). 로그인/파싱 실패는 재시도하지 않는다.
- 상시 브라우저·새 의존성·면목 로그인 환경변수를 추가하지 않는다.
- lastAvailability와 사용자별 sentNotifications를 재사용한다. 유지되는 빈자리 상태는 반복 발송하지 않고, 명확한 마감 후 재개방 시 기존 정책대로 다시 알린다.
- 조회 실패나 available=null은 이전 가용 상태를 초기화하지 않는다. 별도의 면목 공개 snapshot에 상태 확인 불가도 보관해 화면에 표시한다.
- 마지막 시도/성공 시각을 구분한다. 실패·조회 중에는 이전 snapshot임을 표시한다.
- 조건은 서버 state.json의 userId에 저장된다. 기존 기기 연결 코드로 같은 계정을 연결하면 PC·모바일에서 조건을 공유한다. 화면은 기존 30초 폴링에서 조건도 새로 읽는다.
- 시설마다 고정 슬롯 길이가 있는 것으로 취급하지 않는다. 면목 slotMinutes=null / seasonalSlots=true; 실제 durationMinutes는 회차의 시작/종료 시간으로 계산한다.
- 면목은 다른 시설과 별도 조건으로 등록한다. 겨울 6부는 선택 목록에서 제외되고 서버도 거부한다.

## 변경 파일

- src/providers/myeonmokProvider.js: 공개 HTTP 조회, HTML·날짜·정원·상태·안내표 파싱.
- public/myeonmokSlots.js: 이용 날짜 기반 계절 회차, UI와 저장 검증 공유.
- src/constants.js, src/checker.js, src/venueRules.js: 시설 등록 및 공통 조회·선택 통합.
- src/storage.js, src/server.js: 계절 회차 검증, 기존 소유권 검증 유지, API 조건 수정과 사용자 선택 결과 제공.
- src/monitor.js: 공개 snapshot, 알 수 없는 상태 전환 방지, 안내표와 다른 실제 시간에도 회차 기준 매칭.
- src/telegramNotifier.js: 회차·실제 이용시간·잔여 팀 수·KST 요일·공식 링크.
- public/app.js, public/index.html: 서울 중랑구 시설 선택, 계절별 회차, 공개 상태와 조회 시각.
- .env.example: 예시 주기 5분.
- tests/fixtures/myeonmok-public.html: 공개 운영 안내표/달력만 추출. IP·세션·사용자 정보를 제외했다.
- tests/myeonmokProvider.test.js, tests/myeonmokRoutes.test.js: 신규 검증.
- tests/checker.test.js, tests/olympicSession.test.js: 기존 브라우저 테스트가 운영 HTTP 기본값에 의존하지 않게 하고 현재 route API mock을 보완했다.
- README.md, docs/myeonmok.md: 사용·검증 기록.
- 작업 시작 전 이미 수정되어 있던 constants의 OLYMPIC_LOGIN_URL 및 olympicProvider 변경은 보존했다.

## 설정 방법

1. 텔레그램 연결 후 새 알림 화면에서 "서울 중랑구 · 계절별 회차"의 면목구립테니스장을 선택한다.
2. 이용 날짜를 고른 다음 표시된 실제 시간의 회차를 선택한다. 4~9월 6부, 10~3월 5부.
3. 조건을 등록한다. 기존 일시정지/다시 켜기/삭제를 사용한다.
4. PC·모바일은 별도 초대 계정을 만들지 않고 기존 기기 연결 코드를 사용한다.

알림 예시:
면목구립테니스장 빈자리 발견!
2026년 10월 1일 (목)
5부 16:00~17:00 · 잔여 2팀
실제 신청 가능 여부는 공식 사이트에서 확인
https://tennis.jungnangimc.or.kr/page/rent/s01.od.list.php

## 검증과 남은 범위

- npx vitest run --maxWorkers=2 --minWorkers=1: 24개 파일, 231개 테스트 통과.
- 신규 19개 테스트: 0/5·3/5·4/5·변동 정원, 예약완료/예약불가/휴장/미오픈/빈 셀/알 수 없는 상태,
  9→10월·3→4월·연도 전환, 겨울 5부와 6부 제외, 공식 시간 불일치,
  목록 공유·재시도 제한·로그인 오류, 중복/오류/복구/재개방 알림,
  PC·모바일 동일 계정 CRUD·소유권·조회 시각/이전 결과.
- HTTP 어댑터의 공식 사이트 실조회: 목록 1회, 179개 회차 상태, 오류 없음. 가용 개수는 순간값이다.
- 텔레그램은 mock으로만 검증했다. 실사용자에게 테스트 발송하지 않았다.
- 로그인 후 실제 신청 가능 여부, 대기 신청의 내부 의미, 미표시 날짜의 정확한 오픈 상태는 확인하지 않았다.
- PC/모바일 화면의 브라우저 시각 검증은 수행하지 않았다. 동일 계정 동기화는 API 통합 테스트로 검증했다.
- 공개 안내표 구조/회차 수가 바뀌면 파싱 실패로 보고하며 예전 상태를 유지한다.
- Railway의 실제 네트워크 접근은 배포 후 확인이 필요하다.

## Railway

새 환경변수·패키지·Dockerfile·railway.json 변경 없이 기존 배포 방식으로 반영할 수 있다.
기존 Telegram 사용자 연결과 DATA_DIR/영속 볼륨을 계속 사용한다.
배포는 이 작업에서 수행하지 않았다.
