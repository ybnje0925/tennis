import { facilityResultText } from "./availabilitySummary.js";
import { NOWON_FACILITIES, NOWON_TIMES, validateNowonWatch } from "./nowonRules.js";
import { formatKoreanDateWithWeekday, isDateBeforeKstToday } from "./dateFormat.js";
import { myeonmokSlots, myeonmokSlotLabel } from "./myeonmokSlots.js";
import { sortWatchesByReservationTime } from "./watchSorting.js";

const form = document.querySelector("#watchForm");
const inviteForm = document.querySelector("#inviteForm");
const invitePanel = document.querySelector("#invitePanel");
const inviteStatusEl = document.querySelector("#inviteStatus");
const showDeviceLinkButton = document.querySelector("#showDeviceLink");
const deviceLinkClaimForm = document.querySelector("#deviceLinkClaimForm");
const deviceLinkClaimStatusEl = document.querySelector("#deviceLinkClaimStatus");
const appContentEl = document.querySelector("#appContent");
const telegramPanel = document.querySelector("#telegramPanel");
const telegramConnectedPanel = document.querySelector("#telegramConnectedPanel");
const connectTelegramButton = document.querySelector("#connectTelegram");
const refreshTelegramStatusButton = document.querySelector("#refreshTelegramStatus");
const createDeviceLinkButton = document.querySelector("#createDeviceLink");
const deviceLinkResultEl = document.querySelector("#deviceLinkResult");
const statusEl = document.querySelector("#status");
const watchesEl = document.querySelector("#watches");
const timeSlotsEl = document.querySelector("#timeSlots");
const timeSlotsLegendEl = document.querySelector("#timeSlotsLegend");
const testToolsEl = document.querySelector("#testTools");
const logsEl = document.querySelector("#logs");
const lastCheckedEl = document.querySelector("#lastChecked");
const nextCheckEl = document.querySelector("#nextCheck");
const schedulerPolicyEl = document.querySelector("#schedulerPolicy");
const buildInfoEl = document.querySelector("#buildInfo");
const monitoringTitleEl = document.querySelector("#monitoringTitle");
const monitoringDescriptionEl = document.querySelector("#monitoringDescription");
const activeWatchCountEl = document.querySelector("#activeWatchCount");
const connectedVenueCountEl = document.querySelector("#connectedVenueCount");
const watchSummaryEl = document.querySelector("#watchSummary");
const showWatchFormButton = document.querySelector("#showWatchForm");
const gangilStatusEl = document.querySelector("#gangilStatus");
const myeongilStatusEl = document.querySelector("#myeongilStatus");
const olympicStatusEl = document.querySelector("#olympicStatus");
const songpaStatusEl = document.querySelector("#songpaStatus");
const jungnangStatusEl = document.querySelector("#jungnangStatus");
const nowonStatusEl = document.querySelector("#nowonStatus");
const nowonFieldsEl = document.querySelector("#nowonFields");
const nowonCourtEl = document.querySelector("#nowonCourt");
const hanamStatusEl = document.querySelector("#hanamStatus");
const reservationLinks = {
  jungnang: document.querySelector("#jungnangLink"),
  gangil: document.querySelector("#gangilLink"),
  myeongil: document.querySelector("#myeongilLink"),
  olympic: document.querySelector("#olympicLink"),
  songpa: document.querySelector("#songpaLink"),
  nowon: document.querySelector("#nowonLink"),
  hanam: document.querySelector("#hanamLink")
};
const venueGroupsEl = document.querySelector("#venueGroups");
const venueSelectionHelpEl = document.querySelector("#venueSelectionHelp");
const seoulCatalogForm = document.querySelector("#seoulCatalogForm");
const seoulAreaFilterEl = document.querySelector("#seoulAreaFilter");
const seoulPlaceCountEl = document.querySelector("#seoulPlaceCount");
const seoulServiceCountEl = document.querySelector("#seoulServiceCount");
const seoulCatalogStatusEl = document.querySelector("#seoulCatalogStatus");
const seoulPlacesEl = document.querySelector("#seoulPlaces");
let gangdongTimeSlots = [];
let olympicTimeSlots = [];
let oneHourTimeSlots = [];
let venueOptions = [];
let venueNames = {};
let venuePublicUrls = {};
let providerPublicUrls = {};
let currentUser = null;
let lastVisitPing = 0;
let trackedPageUser = null;
let seoulAreas = [];
let displayedWatches = [];
let watchFilter = "all";
let displayActiveWatchCount = null;

async function request(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "요청에 실패했습니다.");
  }
  if (response.status === 204) return null;
  return response.json();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setInviteStatus(message) {
  inviteStatusEl.textContent = message;
}

function setDeviceLinkClaimStatus(message) {
  deviceLinkClaimStatusEl.textContent = message;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}

function formatProviderStatus(status, providerId, active) {
  if (status.currentUserActiveWatchCount === 0) return "현재 계정 조회 대상 아님";
  if (!active) return "미사용";
  const provider = status.providers?.[providerId] || {};
  if (provider.monitoringStatus === "quiet-hours") {
    return `야간 절전 · ${formatDateTime(provider.nextCheckAt)}부터 조회`;
  }
  if (provider.monitoringStatus === "outside-hours") {
    return `운영시간 외 · ${formatDateTime(provider.nextCheckAt)}부터 조회`;
  }
  const stateLabel = provider.status === "running"
    ? "조회 중"
    : provider.status === "pending"
      ? "지연 조회 대기"
      : "감시 중";
  if (provider.status === "running") {
    return `${stateLabel} · ${formatDateTime(provider.lastStartedAt)} 시작`;
  }
  if (providerId === "nowon") return `${provider.lastError ? (provider.lastErrorCategory || "조회 오류") + (provider.lastSuccessfulCheckAt ? " · 이전 성공 결과(오래됨)" : " · 성공 결과 없음") : stateLabel} · 시도 ${formatDateTime(provider.lastAttemptAt)} · 성공 ${formatDateTime(provider.lastSuccessfulCheckAt)} · 다음 ${formatDateTime(provider.nextCheckAt)}`;
  if (providerId === "jungnang") return `${provider.lastError ? "조회 실패 · 이전 성공 결과" : stateLabel} · 시도 ${formatDateTime(provider.lastAttemptAt)} · 성공 ${formatDateTime(provider.lastSuccessfulCheckAt)} · 다음 ${formatDateTime(provider.nextCheckAt)}`;
  return `${stateLabel} · ${formatDateTime(provider.lastCheckedAt)} → ${formatDateTime(provider.nextCheckAt)}`;
}

function formatDate(value) {
  return formatKoreanDateWithWeekday(value);
}

async function loadOptions() {
  const options = await request("/api/options");
  gangdongTimeSlots = options.timeSlots;
  olympicTimeSlots = options.olympicTimeSlots;
  oneHourTimeSlots = options.oneHourTimeSlots || options.olympicTimeSlots;
  venueOptions = options.venues;
  venueNames = Object.fromEntries(venueOptions.map((venue) => [venue.id, venue.name]));
  venuePublicUrls = Object.fromEntries(venueOptions.map((venue) => [venue.id, venue.publicUrl]));
  providerPublicUrls = Object.fromEntries(Object.values(options.providers || {}).map((provider) => [provider.id, provider.publicUrl]));
  updateReservationLinks();
  renderVenueGroups();
  renderTimeSlots(gangdongTimeSlots);
  testToolsEl.classList.toggle("hidden", !options.enableTestTools);
}

async function loadSession() {
  const session = await request("/api/session");
  currentUser = session.user;
  invitePanel.classList.toggle("hidden", session.authenticated);
  appContentEl.classList.toggle("hidden", !session.authenticated);
  telegramPanel.classList.toggle("hidden", !session.authenticated || currentUser.telegramConnected);
  telegramConnectedPanel.classList.toggle("hidden", !session.authenticated || !currentUser.telegramConnected);
  document.querySelector("#topConnection").textContent = currentUser?.telegramConnected ? "✓ 텔레그램 연결됨" : "텔레그램 연결 필요";
  form.querySelector("button[type='submit']").disabled = !currentUser?.telegramConnected;
  if (session.authenticated && !currentUser.telegramConnected) {
    setStatus("텔레그램 연결 후 알림을 등록할 수 있습니다.");
  }
  return session;
}

function updateReservationLinks() {
  const links = {
    jungnang: providerPublicUrls.jungnang,
    gangil: venuePublicUrls.gangil,
    myeongil: venuePublicUrls.myeongil,
    olympic: venuePublicUrls.olympic,
    songpa: providerPublicUrls.songpa,
    nowon: providerPublicUrls.nowon,
    hanam: providerPublicUrls.hanam
  };

  for (const [id, url] of Object.entries(links)) {
    const link = reservationLinks[id];
    if (!link || !isPublicHttpUrl(url)) {
      link.removeAttribute("href");
      link.classList.add("hidden");
      continue;
    }
    link.href = url;
    link.classList.remove("hidden");
  }
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function loadStatus() {
  const status = await request("/api/status");
  lastCheckedEl.textContent = formatDateTime(status.currentUserLastCheckedAt);
  nextCheckEl.textContent = formatDateTime(status.currentUserNextCheckAt);
  const gangdongActive = Boolean(status.activeVenues?.gangil || status.activeVenues?.myeongil);
  const songpaActive = ["songpa-oryun", "songpa-seongnaecheon", "songpa-songpa", "songpa-ogeum"].some((id) => status.activeVenues?.[id]);
  const hanamActive = ["hanam-tennis-1", "hanam-tennis-2", "misa-all", "misa-court-1", "misa-court-2", "misa-court-3", "misa-court-4"].some((id) => status.activeVenues?.[id]);
  gangilStatusEl.textContent = formatProviderStatus(status, "gangdong", gangdongActive);
  myeongilStatusEl.textContent = formatProviderStatus(status, "gangdong", gangdongActive);
  olympicStatusEl.textContent = formatProviderStatus(status, "olympic", status.activeVenues?.olympic);
  songpaStatusEl.textContent = formatProviderStatus(status, "songpa", songpaActive);
  nowonStatusEl.textContent = formatProviderStatus(status, "nowon", Object.keys(NOWON_FACILITIES).some(id => status.activeVenues?.[id]));
  hanamStatusEl.textContent = formatProviderStatus(status, "hanam", hanamActive);
  jungnangStatusEl.textContent = formatProviderStatus(status, "jungnang", Boolean(status.activeVenues?.myeonmok));
  const activeWatchCount = displayActiveWatchCount ?? Number(status.currentUserActiveWatchCount || 0);
  const quietHoursActive = status.schedulerPolicy?.quietHoursActive;
  monitoringTitleEl.textContent = quietHoursActive ? "야간 절전 중" : activeWatchCount > 0 ? "모니터링 중" : "모니터링 대기 중";
  monitoringDescriptionEl.textContent = quietHoursActive
    ? `01:00~06:00에는 자동 조회를 쉬고 ${formatDateTime(status.schedulerPolicy?.nextActiveAt)}부터 다시 확인해요.`
    : activeWatchCount > 0
      ? "선택한 시설의 잔여 코트를 주기적으로 확인하고 있어요."
      : "활성 알림이 없으면 예약현황을 조회하지 않아 사용량을 아껴요.";
  schedulerPolicyEl.textContent = quietHoursActive
    ? "매일 한국 시간 01:00~06:00 자동 중지"
    : "활성 알림이 있을 때만 확인 · 매일 01:00~06:00 자동 중지";
  document.querySelector("#homeStatusBadge").textContent = monitoringTitleEl.textContent;
  document.querySelector("#homeStatusTimes").textContent = `최근 ${lastCheckedEl.textContent} · 다음 ${nextCheckEl.textContent}`;
  renderLogs(status);
  document.querySelector("#homeMonitor").textContent = `${monitoringTitleEl.textContent} · 최근 ${lastCheckedEl.textContent} · 다음 ${nextCheckEl.textContent}`;
  buildInfoEl.textContent = `build ${shortCommit(status.buildCommit)} · scheduler ${status.schedulerVersion}`;
}

async function loadSeoulCatalog(filters = {}) {
  seoulCatalogStatusEl.textContent = "서울시 catalog 조회 중...";
  const params = new URLSearchParams();
  if (filters.area) params.set("area", filters.area);
  if (filters.q) params.set("q", filters.q);
  const catalog = await request(`/api/seoul/tennis-services${params.size ? `?${params}` : ""}`);
  seoulPlaceCountEl.textContent = `${catalog.uniquePlaceCount}곳`;
  seoulServiceCountEl.textContent = `${catalog.totalServiceCount}건`;
  seoulCatalogStatusEl.textContent = catalog.stale
    ? "서울시 API 오류로 이전 데이터를 표시 중입니다."
    : `${catalog.cached ? "cache" : "fresh"} · ${formatDateTime(catalog.fetchedAt)}`;
  updateSeoulAreaOptions(catalog);
  renderSeoulPlaces(catalog.places || []);
}

function updateSeoulAreaOptions(catalog) {
  const selected = seoulAreaFilterEl.value;
  const nextAreas = Array.from(new Set((catalog.places || []).map((place) => place.areaName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
  if (seoulAreas.join("|") === nextAreas.join("|")) return;
  seoulAreas = nextAreas;
  seoulAreaFilterEl.innerHTML = `<option value="">전체</option>${seoulAreas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("")}`;
  seoulAreaFilterEl.value = seoulAreas.includes(selected) ? selected : "";
}

function renderSeoulPlaces(places) {
  seoulPlacesEl.innerHTML = "";
  if (places.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "표시할 서울시 테니스 장소가 없습니다.";
    seoulPlacesEl.append(empty);
    return;
  }

  for (const place of places.slice(0, 60)) {
    const entry = document.createElement("details");
    entry.className = "seoul-place";
    const summary = document.createElement("summary");
    summary.textContent = `[${place.areaName || "지역 미상"}] ${place.placeName || "장소 미상"} · 서비스 ${place.serviceCount}건`;
    entry.append(summary);

    const list = document.createElement("div");
    list.className = "seoul-service-list";
    for (const service of place.services || []) {
      list.append(createSeoulService(service));
    }
    entry.append(list);
    seoulPlacesEl.append(entry);
  }

  if (places.length > 60) {
    const more = document.createElement("p");
    more.className = "empty";
    more.textContent = `검색 결과가 많아 60곳만 표시합니다. 자치구나 장소명으로 좁혀보세요.`;
    seoulPlacesEl.append(more);
  }
}

function createSeoulService(service) {
  const article = document.createElement("article");
  article.className = "seoul-service";
  const title = document.createElement("strong");
  title.textContent = service.serviceName || "-";
  const status = document.createElement("p");
  status.textContent = `접수상태: ${service.status || "-"}`;
  const servicePeriod = document.createElement("p");
  servicePeriod.textContent = `이용기간: ${formatPeriod(service.serviceOpenAt, service.serviceCloseAt)}`;
  const receptionPeriod = document.createElement("p");
  receptionPeriod.textContent = `접수기간: ${formatPeriod(service.receptionOpenAt, service.receptionCloseAt)}`;
  article.append(title, status, servicePeriod, receptionPeriod);
  if (isPublicHttpUrl(service.reservationUrl)) {
    const link = document.createElement("a");
    link.href = service.reservationUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "reservation-link";
    link.textContent = "예약페이지";
    article.append(link);
  }
  return article;
}

function formatPeriod(start, end) {
  if (!start && !end) return "-";
  return `${formatDateOnly(start)} ~ ${formatDateOnly(end)}`;
}

function formatDateOnly(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Seoul"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLogs(status) {
  const logs = status.logs || [];
  const logIds = status.logIds || [];
  const details = status.logDetails || [];
  logsEl.innerHTML = "";
  if (logs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "아직 로그가 없습니다.";
    logsEl.append(empty);
    return;
  }

  logs
    .map((line, index) => ({ line, detail: matchingLogDetail(line, logIds[index], details[index]) }))
    .reverse()
    .forEach(({ line, detail }) => logsEl.append(createLogEntry(line, detail, status.providers || {})));
}

function matchingLogDetail(line, logId, indexedDetail) {
  const detail = logId
    ? indexedDetail?.logId === logId ? indexedDetail : null
    : indexedDetail?.line === line ? indexedDetail : null;
  if (!detail) return null;
  const labels = { nowon: "노원", jungnang: "중랑", gangdong: "강동", songpa: "송파", olympic: "올림픽", hanam: "하남" };
  return (detail.errors || []).every((error) => !error?.provider || line.includes(labels[error.provider] || error.provider)) ? detail : null;
}

function createLogEntry(line, detail, providers) {
  const lines = String(line || "").split("\n").filter(Boolean);
  const summaryText = lines[0] || "-";
  const embeddedDetails = lines.slice(1);
  const hasDetails = embeddedDetails.length > 0 || detail?.errors?.length || detail?.facilities?.length || detail?.skippedProviders?.length || detail?.notificationErrors?.length;

  if (!hasDetails) {
    const row = document.createElement("div");
    row.className = "log-line";
    row.textContent = summaryText;
    return row;
  }

  const entry = document.createElement("details");
  entry.className = `log-entry ${/실패|ERROR|TIMEOUT|BLOCKED|NOT_FOUND/.test(line) ? "has-error" : ""}`;
  const summary = document.createElement("summary");
  summary.textContent = summaryText;
  entry.append(summary);

  const body = document.createElement("div");
  body.className = "log-detail";
  if (embeddedDetails.length > 0) {
    const embedded = document.createElement("div");
    embedded.className = "log-detail-block";
    embeddedDetails.forEach((item) => {
      const lineEl = document.createElement("p");
      lineEl.textContent = item;
      embedded.append(lineEl);
    });
    body.append(embedded);
  }

  const errors = detail?.errors || [];
  if (errors.length > 0) body.append(renderErrorDetails(errors));
  if (detail?.facilities?.length) body.append(renderFacilityDetails(detail.facilities));
  if (detail?.skippedProviders?.length) body.append(renderSkippedProviderDetails(detail.skippedProviders));
  if (detail?.notificationErrors?.length) body.append(renderNotificationErrorDetails(detail.notificationErrors));

  entry.append(body);
  return entry;
}

function renderErrorDetails(errors) {
  const section = document.createElement("section");
  section.className = "log-detail-block";
  section.append(logDetailTitle("문제 상세"));
  errors.forEach((error) => {
    const guide = errorGuide(error);
    const row = document.createElement("dl");
    row.className = "log-detail-grid";
    appendDetail(row, "시설", error.venueName || error.providerName || error.provider || "-");
    appendDetail(row, "날짜", error.targetDate || "-");
    appendDetail(row, "분류", guide.category);
    appendDetail(row, "설명", guide.summary);
    appendDetail(row, "다음 조치", guide.action);
    section.append(row);
  });
  return section;
}

function renderFacilityDetails(facilities) {
  const section = document.createElement("section");
  section.className = "log-detail-block";
  section.append(logDetailTitle("내 알림 조건의 조회 결과"));
  facilities.forEach((facility) => {
    const row = document.createElement("p");
    row.textContent = `${facility.venueName || facility.venueId}: ${facility.resultMessage || facilityResultText(facility)}`;
    section.append(row);
  });
  return section;
}

function renderSkippedProviderDetails(skippedProviders) {
  const section = document.createElement("section");
  section.className = "log-detail-block";
  section.append(logDetailTitle("건너뜀"));
  skippedProviders.forEach((provider) => {
    const row = document.createElement("p");
    row.textContent = `${provider.providerName || provider.provider}: ${provider.reason || "-"}`;
    section.append(row);
  });
  return section;
}

function renderNotificationErrorDetails(errors) {
  const section = document.createElement("section");
  section.className = "log-detail-block";
  section.append(logDetailTitle("알림 발송 문제"));
  errors.forEach((error) => {
    const row = document.createElement("dl");
    row.className = "log-detail-grid";
    appendDetail(row, "분류", "텔레그램 발송 실패");
    appendDetail(row, "건수", `${error.count || 0}건`);
    appendDetail(row, "설명", error.message || "-");
    appendDetail(row, "다음 조치", "조회는 성공했지만 알림 발송이 실패했습니다. 다음 빈자리 감지 때 다시 발송을 시도합니다.");
    section.append(row);
  });
  return section;
}

function logDetailTitle(text) {
  const title = document.createElement("h3");
  title.textContent = text;
  return title;
}

function appendDetail(row, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  row.append(term, description);
}

function facilityStatusLabel(status) {
  if (status === "checked") return "조회됨";
  if (status === "failed") return "실패";
  if (status === "skipped") return "건너뜀";
  return "이번 주기 조회 대상 아님";
}

function errorGuide(error) {
  if (error.userCategory || error.userMessage || error.userAction) {
    return {
      category: error.userCategory || "조회 문제",
      summary: error.userMessage || "예약현황 조회 중 문제가 발생했습니다.",
      action: error.userAction || "다음 조회 때 다시 시도됩니다. 반복되면 상태를 확인해 주세요."
    };
  }
  return guideForType(error.type, error.message);
}

function guideForType(type, message = "") {
  const text = String(message || "");
  if (type === "BROWSER_LAUNCH_FAILED") {
    const summary = /EAGAIN|resource|temporar/i.test(text)
      ? "서버 자원이 잠시 부족해서 예약 사이트를 확인할 브라우저를 새로 열지 못했습니다."
      : /SIGTRAP|Target page, context or browser has been closed|browser has been closed/i.test(text)
        ? "예약 사이트를 확인하려고 브라우저를 켰지만, 시작 직후 브라우저가 종료됐습니다."
        : "예약 사이트를 확인할 브라우저를 시작하지 못했습니다.";
    return {
      category: "브라우저 시작 문제",
      summary,
      action: "대부분 일시적인 문제라 다음 조회 때 다시 시도됩니다. 반복되면 서버 재시작이나 메모리/프로세스 사용량 확인이 필요합니다."
    };
  }
  if (type === "TIMEOUT") {
    return {
      category: "응답 지연",
      summary: "예약 사이트가 제한 시간 안에 응답하지 않았습니다.",
      action: "잠시 후 자동으로 다시 조회됩니다. 같은 시설에서 반복되면 해당 사이트가 느리거나 점검 중일 수 있습니다."
    };
  }
  if (["NETWORK_DNS", "NETWORK_TLS", "NETWORK_ERROR"].includes(type)) {
    return {
      category: "네트워크 문제",
      summary: "예약 사이트에 연결하는 중 문제가 났습니다.",
      action: "대부분 일시적인 연결 문제라 다음 조회 때 다시 시도됩니다."
    };
  }
  if (type === "LOGIN_OR_PROTECTION_PAGE") {
    return {
      category: "로그인/접근 보호 문제",
      summary: "예약현황 대신 로그인 화면이나 접근 보호 화면이 나타났습니다.",
      action: "계정 로그인 상태, 중복 로그인, 사이트 차단 안내가 있는지 확인이 필요합니다."
    };
  }
  if (type === "CALENDAR_DATE_NOT_FOUND") {
    return {
      category: "날짜 선택 문제",
      summary: "예약 달력에서 요청한 날짜를 찾지 못했습니다.",
      action: "예약 가능 기간이 아직 열리지 않았거나 사이트 화면 구성이 바뀌었을 수 있습니다."
    };
  }
  if (type === "PARSE_FAILED") {
    return {
      category: "화면 읽기 문제",
      summary: "예약 사이트 화면은 열렸지만 빈자리 정보를 읽어내지 못했습니다.",
      action: "사이트 화면 구성이 바뀌었을 가능성이 있습니다. 반복되면 파서 수정이 필요합니다."
    };
  }
  return {
    category: "알 수 없는 조회 문제",
    summary: "예약현황 조회 중 예상하지 못한 문제가 발생했습니다.",
    action: "다음 조회 때 다시 시도됩니다. 반복되면 기술 로그를 확인해 원인을 좁혀야 합니다."
  };
}

function shortCommit(value) {
  if (!value || value === "unknown") return "unknown";
  return String(value).slice(0, 7);
}

async function loadWatches() {
  const watches = await request("/api/watches");
  displayedWatches = watches;
  renderWatches(watches);
  document.querySelector("#heroCount").textContent = `지금 ${displayActiveWatchCount}개의 조건을 확인하고 있어요.`;
}

function renderWatches(watches) {
  const home = document.querySelector('[data-screen="home"]');
  home.querySelectorAll('.intro,.hero,#homeStatusLine,#watchFilters,.section-heading').forEach(el => el.classList.toggle('hidden', watches.length === 0));
  document.querySelector('#emptyHomeTitle').classList.toggle('hidden', watches.length !== 0);
  const expiredWatches = watches.filter((watch) => isExpiredWatchDate(watch.date));
  const activeWatches = watches.filter((watch) => watch.enabled !== false && !isExpiredWatchDate(watch.date));
  displayActiveWatchCount = activeWatches.length;
  const connectedVenues = new Set(activeWatches.flatMap((watch) => watch.venues || []));
  activeWatchCountEl.textContent = String(activeWatches.length);
  connectedVenueCountEl.textContent = String(connectedVenues.size);
  watchSummaryEl.textContent = watchSummaryText(activeWatches.length, expiredWatches.length);
  const categories = { all: watches, active: activeWatches, paused: watches.filter(w => w.enabled === false && !isExpiredWatchDate(w.date)), expired: expiredWatches };
  document.querySelector("#watchFilters").innerHTML = [["all","전체"],["active","활성"],["paused","일시정지"],["expired","만료"]].map(([key,label]) => `<button class="chip ${watchFilter === key ? "selected" : ""}" data-watch-filter="${key}" aria-pressed="${watchFilter === key}">${label} ${categories[key].length}</button>`).join("");
  if (watches.length === 0) {
    watchesEl.innerHTML = `<div class="empty"><div class="empty-ball"><span class="ball" aria-hidden="true"></span></div><p class="kicker">YOUR NEXT MATCH</p><h2>다음 테니스는<br>어디서 치고 싶으세요?</h2><p>테니스장과 날짜, 시간을 선택해 주세요.<br>빈자리가 나면 텔레그램으로 알려드릴게요.</p><button class="primary wide" data-go="${currentUser?.telegramConnected ? "new" : "settings"}">${currentUser?.telegramConnected ? "＋ 첫 알림 만들기" : "텔레그램 먼저 연결하기"}</button></div>`;
    return;
  }
  const filtered = sortWatchesByReservationTime(categories[watchFilter]);
  watchesEl.innerHTML = filtered.length ? filtered.map(renderWatchCard).join("") : '<div class="notice">이 조건에 해당하는 알림이 없습니다.</div>';
}

function renderWatchCard(watch) {
      const venues = watch.venues.map((venue) => escapeHtml(venueNames[venue] || venue)).join(", ");
      const date = formatWatchDate(watch.date);
      let timeLabels = watch.anyTime ? "<span>시간대 상관없음</span>" : watch.times.map((time) => `<span>${watch.venues.includes("myeonmok") ? myeonmokSlotLabel(watch.date, time) : time}</span>`).join("");
      if (watch.provider === "nowon") timeLabels += `<span>${watch.courts?.length ? watch.courts.join(", ") + "코트" : "전체 코트"} · ${watch.durationMinutes === 120 ? "연속 2시간" : "1시간"}</span>`;
      const expired = isExpiredWatchDate(watch.date);
      const state = expired ? "만료됨" : watch.enabled === false ? "일시정지" : "알림 켜짐";
      return `
        <details class="watch ${expired ? "expired" : watch.enabled === false ? "disabled" : ""}">
          <summary class="watch-summary">
            <div class="watch-main">
              <div class="watch-date"><span class="badge ${expired || watch.enabled === false ? "paused" : ""}">${state}</span>
                <strong>${date.day}</strong>
                <span>${date.year}</span>
              </div>
              <div class="watch-details">
                <strong>${venues}</strong>
                <div class="watch-meta">${timeLabels}</div>
                <div class="watch-state">${state}</div>
              </div>
            </div>
            <div class="watch-summary-side">
              <span class="watch-switch ${watch.enabled !== false && !expired ? "is-on" : ""}" aria-hidden="true"><span></span></span>
              <span class="watch-state-label">${state}</span>
              <span class="watch-chevron" aria-hidden="true"></span>
            </div>
          </summary>
          <div class="watch-expanded">
            <div class="watch-expanded-content">
            <p>${expired ? "지난 날짜의 알림입니다. 필요하지 않다면 삭제해 주세요." : "알림 조건을 일시정지하거나 다시 켤 수 있어요."}</p>

            </div>
            <div class="watch-actions">
              <button type="button" data-toggle="${watch.id}" data-enabled="${watch.enabled !== false}" ${expired ? "disabled" : ""}>
                ${watch.enabled === false ? "알림 켜기" : "일시정지"}
              </button>
              <button type="button" data-delete="${watch.id}">삭제</button>
            </div>
          </div>
        </details>
      `;
}

function formatWatchDate(value) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return { day: formatDate(value), year: "" };
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }).format(date);
  const monthDay = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(date).replace(/\s/g, "");
  const year = new Intl.DateTimeFormat("ko-KR", { year: "numeric", timeZone: "Asia/Seoul" }).format(date);
  return { day: `${monthDay} (${weekday})`, year };
}

function isExpiredWatchDate(value) {
  return isDateBeforeKstToday(value);
}

function watchSummaryText(activeCount, expiredCount) {
  const active = activeCount > 0 ? `${activeCount}개가 활성화 중이에요.` : "아직 활성화한 알림이 없어요.";
  return expiredCount > 0 ? `${active} 만료 ${expiredCount}개` : active;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser?.telegramConnected) {
    setStatus("텔레그램 연결 후 알림을 등록할 수 있습니다.");
    return;
  }
  const data = new FormData(form);
  const payload = {
    venues: data.getAll("venues"),
    date: data.get("date"),
    anyTime: data.get("anyTime") === "on",
    times: data.get("anyTime") === "on" ? [...timeSlotsEl.querySelectorAll("input[name=times]")].map(input => input.value) : data.getAll("times")
  };
  try {
    if (payload.venues.some(id => NOWON_FACILITIES[id])) {
      payload.courts = data.get("nowonCourt") ? [data.get("nowonCourt")] : [];
      payload.durationMinutes = Number(data.get("nowonDuration"));
      validateNowonWatch(payload);
    }
    await request("/api/watches", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    updateOlympicFields();
    setStatus("알림 조건을 등록했습니다. 현재 빈자리가 있으면 1회 알려드립니다.");
    await loadWatches();
    await loadStatus();
    goScreen("home");
  } catch (error) {
    setStatus(error.message);
  }
});

inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(inviteForm);
  try {
    await request("/api/invite/claim", {
      method: "POST",
      body: JSON.stringify({
        code: data.get("code"),
        name: data.get("name")
      })
    });
    inviteForm.reset();
    setInviteStatus("");
    await bootApp();
  } catch (error) {
    setInviteStatus(error.message);
  }
});

showDeviceLinkButton.addEventListener("click", () => {
  deviceLinkClaimForm.classList.toggle("hidden");
  setDeviceLinkClaimStatus("");
});

deviceLinkClaimForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(deviceLinkClaimForm);
  try {
    await request("/api/device-link/claim", {
      method: "POST",
      body: JSON.stringify({ code: data.get("code") })
    });
    deviceLinkClaimForm.reset();
    setDeviceLinkClaimStatus("");
    await bootApp();
  } catch (error) {
    setDeviceLinkClaimStatus(error.message);
  }
});

connectTelegramButton.addEventListener("click", async () => {
  try {
    const result = await request("/api/telegram/link-token", { method: "POST", body: "{}" });
    window.open(result.url, "_blank", "noopener,noreferrer");
    setStatus("Telegram에서 /start 메시지를 보낸 뒤 잠시 후 화면을 새로고침합니다.");
    setTimeout(bootApp, 5000);
  } catch (error) {
    setStatus(error.message);
  }
});

refreshTelegramStatusButton.addEventListener("click", async () => {
  try {
    await request("/api/telegram/test", { method: "POST", body: "{}" });
    setStatus("텔레그램으로 연결 상태 메시지를 보냈습니다.");
  } catch (error) {
    setStatus(error.message);
  }
});

createDeviceLinkButton.addEventListener("click", async () => {
  try {
    const result = await request("/api/device-link", { method: "POST", body: "{}" });
    deviceLinkResultEl.classList.remove("hidden");
    deviceLinkResultEl.innerHTML = "";
    const label = document.createElement("p");
    label.textContent = "다른 기기에서 아래 코드를 입력하세요.";
    const code = document.createElement("strong");
    code.textContent = result.code;
    const expiry = document.createElement("p");
    expiry.textContent = "10분 동안 사용할 수 있습니다. 한 번 사용하면 자동으로 만료됩니다.";
    deviceLinkResultEl.append(label, code, expiry);
  } catch (error) {
    setStatus(error.message);
  }
});

form.addEventListener("change", () => {
  updateVenueSelection();
});

function updateVenueSelection() {
  const data = new FormData(form);
  const selectedIds = data.getAll("venues");
  const nowon = selectedIds.some(id => NOWON_FACILITIES[id]);
  const seasonal = selectedIds.includes("myeonmok");
  nowonFieldsEl.classList.toggle("hidden", !nowon);
  const previousCourt = nowonCourtEl.value;
  const courtCount = nowon ? Math.min(...selectedIds.map(id => NOWON_FACILITIES[id]?.courtCount || 0)) : 0;
  nowonCourtEl.innerHTML = '<option value="">전체 코트</option>' + Array.from({ length: courtCount }, (_, i) => `<option value="${i + 1}">${i + 1}코트</option>`).join("");
  if (Number(previousCourt) <= courtCount) nowonCourtEl.value = previousCourt;
  const selectedSlotMinutes = getSelectedSlotMinutes(data.getAll("venues"));
  for (const input of form.querySelectorAll("input[name='venues']")) {
    const slotMinutes = Number(input.dataset.slotMinutes);
    input.disabled = !input.checked && ((nowon && !NOWON_FACILITIES[input.value]) || (!nowon && selectedIds.length > 0 && NOWON_FACILITIES[input.value]) || (seasonal ? input.value !== "myeonmok" : Boolean(selectedSlotMinutes && slotMinutes !== selectedSlotMinutes)));
  }

  if (selectedSlotMinutes === 120) {
    venueSelectionHelpEl.textContent = "예약단위가 다른 테니스장은 함께 선택할 수 없습니다.";
  } else if (selectedSlotMinutes === 60) {
    venueSelectionHelpEl.textContent = "1시간 단위 예약 시설입니다. 2시간 단위 시설과 별도로 알림을 등록해주세요.";
  } else {
    venueSelectionHelpEl.textContent = "";
  }

  timeSlotsLegendEl.textContent = seasonal ? "회차별 실제 이용시간" : selectedSlotMinutes === 60 ? "1시간 단위 시간대" : "시간대";
  if (seasonal) venueSelectionHelpEl.textContent = "회차별 잔여 팀 수를 조회합니다. 실제 신청 가능 여부는 공식 사이트에서 확인";
  if (nowon) venueSelectionHelpEl.textContent = "노원 조회 준비 중으로 현재 알림 발송이 중지되어 있습니다. 예약은 공식 사이트에서 본인 계정으로 진행하세요.";
  renderTimeSlots(nowon ? NOWON_TIMES : seasonal ? myeonmokSlots(data.get("date")) : selectedSlotMinutes === 60 ? oneHourTimeSlots : gangdongTimeSlots);
}

function renderVenueGroups() {
  const regions = ["서울 강동구", "서울 송파구", "서울 중랑구", "서울 노원구", "경기 하남시"];
  venueGroupsEl.innerHTML = regions.map(region => {
    const venues = venueOptions.filter(venue => venue.region === region);
    if (!venues.length) return "";
    const durations = [60, 120, null];
    const sections = durations.map(minutes => {
      const matches = venues.filter(venue => venue.slotMinutes === minutes);
      if (!matches.length) return "";
      const title = minutes ? minutes / 60 + "시간 예약" : "이용시간은 날짜 선택 후 확인";
      return `<div class="venue-duration-group"><div class="venue-duration-title">${title}</div>
        ${matches.map(venue => `<label class="venue-option">
          <input type="checkbox" name="venues" value="${venue.id}" data-slot-minutes="${venue.slotMinutes}" />
          <span class="venue-name">${venue.name}</span>
        </label>`).join("")}</div>`;
    }).join("");
    return `<details class="venue-group" ${region === regions[0] ? "open" : ""}><summary class="venue-group-title">${region} · ${venues.length}개 선택 항목</summary>${sections}</details>`;
  }).join("");
}

function getSelectedSlotMinutes(selectedVenueIds) {
  const selected = venueOptions.filter((venue) => selectedVenueIds.includes(venue.id));
  const groups = new Set(selected.map((venue) => venue.slotMinutes));
  return groups.size === 1 ? Array.from(groups)[0] : null;
}

function renderTimeSlots(slots) {
  const selected = new Set(new FormData(form).getAll("times"));
  timeSlotsEl.innerHTML = slots
    .map((slot) => `<label><input type="checkbox" name="times" value="${slot}" ${selected.has(slot) ? "checked" : ""} /> ${new FormData(form).getAll("venues").includes("myeonmok") ? myeonmokSlotLabel(new FormData(form).get("date"), slot) : slot}</label>`)
    .join("");
  syncAnyTime();
}

function syncAnyTime() {
  const any = form.elements.anyTime.checked;
  timeSlotsEl.querySelectorAll("input").forEach(input => { input.disabled = any; });
  timeSlotsEl.style.opacity = any ? "0.5" : "";
}
form.elements.anyTime.addEventListener("change", syncAnyTime);

watchesEl.addEventListener("click", async (event) => {
  const deleteId = event.target?.dataset?.delete;
  const toggleId = event.target?.dataset?.toggle;
  // 그룹/알림 카드의 summary는 native <details>가 접히고 펼쳐지는 동작을
  // 그대로 처리해야 한다. 실제 액션 버튼을 누른 경우에만 목록을 다시 그린다.
  if (!deleteId && !toggleId) return;
  if (deleteId) {
    await request(`/api/watches/${deleteId}`, { method: "DELETE" });
  }
  if (toggleId) {
    const enabled = event.target.dataset.enabled !== "true";
    await request(`/api/watches/${toggleId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled })
    });
  }
  await loadWatches();
  await loadStatus();
});

document.querySelector("#fakeAvailability").addEventListener("click", async () => {
  try {
    const result = await request("/api/test/fake-availability", { method: "POST", body: "{}" });
    setStatus(`테스트 완료: 알림 ${result.notificationCount}건`);
  } catch (error) {
    setStatus(error.message);
  }
});

showWatchFormButton.addEventListener("click", () => {
  goScreen("new");
  form.querySelector("input[name='venues']")?.focus({ preventScroll: true });
});

seoulCatalogForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(seoulCatalogForm);
  try {
    await loadSeoulCatalog({
      area: data.get("area"),
      q: data.get("q")
    });
  } catch (error) {
    seoulCatalogStatusEl.textContent = error.message;
  }
});

function updateOlympicFields() {
  updateVenueSelection();
}

async function bootApp() {
  const session = await loadSession();
  if (!session.authenticated) return;
  trackVisit(trackedPageUser !== currentUser.id);
  trackedPageUser = currentUser.id;
  goScreen("home");
  await loadOptions();
  updateVenueSelection();
  await loadWatches();
  await loadStatus();
  await refreshDeliverySummary();
  await loadSeoulCatalog().catch((error) => {
    seoulCatalogStatusEl.textContent = error.message;
  });
}

let screen = "home";
let formStep = 1;
let historyPeriod = "all";
let historyStatus = "all";
let historyOffset = null;
let historyGeneration = 0;
function goScreen(next) {
  screen = next;
  document.querySelectorAll("[data-screen]").forEach(el => el.classList.toggle("hidden", el.dataset.screen !== next));
  document.querySelectorAll(".bottom [data-go], .side [data-go]").forEach(el => {
    const selected = el.dataset.go === next;
    el.classList.toggle("on", selected);
    if (selected) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
  });
  if (next === "new") { setFormStep(1); document.querySelector("#newConnectionNotice").classList.toggle("hidden", Boolean(currentUser?.telegramConnected)); }
  if (next === "results") loadDeliveries();
  window.scrollTo(0, 0);
  const heading = document.querySelector(`[data-screen="${next}"] h1`);
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
}
function setFormStep(step) {
  formStep = step;
  document.querySelector("#venueStep").classList.toggle("hidden", step !== 1);
  document.querySelector("#scheduleStep").classList.toggle("hidden", step !== 2);
  document.querySelector("#nextFormStep").classList.toggle("hidden", step !== 1);
  document.querySelector("#previousFormStep").classList.toggle("hidden", step !== 2);
  form.querySelector("button[type=submit]").classList.toggle("hidden", step !== 2);
  document.querySelector("#progressSecond").classList.toggle("filled", step === 2);
  document.querySelector("#formTitle").textContent = step === 1 ? "테니스장을 선택해요." : "날짜와 시간을 정해요.";
  document.querySelector("#formStepLabel").textContent = step === 1 ? "1 / 2 · 원하는 시설을 골라주세요." : "2 / 2 · 빈자리를 기다릴 조건을 확인하세요.";
  updatePreview();
}
function updatePreview() {
  const data = new FormData(form);
  const names = data.getAll("venues").map(id => venueNames[id] || id).join(", ");
  const times = data.get("anyTime") ? "시간대 상관없음" : data.getAll("times").join(", ");
  document.querySelector("#formPreview").innerHTML = `<p class="kicker">선택한 조건</p><h3>${escapeHtml(names || "시설을 선택해 주세요")}</h3><p>${escapeHtml(data.get("date") || "날짜를 선택해 주세요")}<br>${escapeHtml(times || "시간을 선택해 주세요")}</p><div class="divider"></div><p class="muted">${currentUser?.telegramConnected ? "✓ 텔레그램 연결됨" : "텔레그램 연결 필요"}</p>`;
}
document.addEventListener("click", event => {
  const watchTab = event.target.closest("[data-watch-filter]");
  if (watchTab) { watchFilter = watchTab.dataset.watchFilter; renderWatches(displayedWatches); }
  const target = event.target.closest("[data-go]");
  if (target) goScreen(target.dataset.go);
  const period = event.target.closest("[data-period]");
  if (period) { historyPeriod = period.dataset.period; loadDeliveries(); }
});
document.querySelector("#nextFormStep").addEventListener("click", () => {
  if (!new FormData(form).getAll("venues").length) return setStatus("테니스장을 선택해 주세요.");
  setStatus(currentUser?.telegramConnected ? "" : "텔레그램 연결 후 알림을 등록할 수 있습니다.");
  setFormStep(2); window.scrollTo(0, 0);
});
document.querySelector("#previousFormStep").addEventListener("click", () => setFormStep(1));
form.addEventListener("change", updatePreview);
document.querySelector("#deliveryFilter").addEventListener("change", event => { historyStatus = event.target.value; loadDeliveries(); });
document.querySelector("#deliveryMore").addEventListener("click", () => loadDeliveries(true));
document.querySelector("#deliveryRetry").addEventListener("click", () => loadDeliveries());
function historyMarkup(rows) {
  let day = "";
  return rows.map(row => {
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date(row.at));
    const heading = date !== day ? `<h3 class="dayheading">${escapeHtml(formatDate(date))}</h3>` : "";
    day = date;
    const sent = row.status === "sent";
    const names = [...new Set(row.items.map(i => i.venueName))].join(", ");
    const bookings = row.items.filter(i => i.date).map(i => `${formatDate(i.date)} · ${i.time}${i.courtNo ? ` · ${i.courtNo}코트` : ""}`).join("\n");
    return `${heading}<details class="history-item"><summary><div class="row"><span class="sent-at">${sent ? "발송" : "실패 시도"} ${escapeHtml(formatDateTime(row.at))}</span><span class="badge ${sent ? "" : "failed"}">${sent ? "✓ 발송 완료" : "! 발송 실패"}</span></div><h3>${escapeHtml(names || "테니스장 상세 기록 없음")}</h3><div class="booking"><span class="muted">예약 대상 · 코트 이용 날짜와 시간</span><strong style="white-space:pre-line">${escapeHtml(bookings || "상세 기록 없음")}</strong></div><p class="more">당시 ${sent ? "발송" : "발송 시도"} 내용 보기 ⌄</p></summary><div class="message-body">${escapeHtml(row.message || "상세 기록 없음")}</div><p class="muted">${sent ? "발송 당시 기록이며 현재 빈자리와 다를 수 있어요. 전송 성공은 읽음 확인이 아닙니다." : "전송에 실패하여 성공 건수에서 제외합니다."}</p>${row.attemptCount > 1 ? `<p class="muted">같은 발송 건 전송 시도 ${row.attemptCount}회 · 최근 시도 기록</p>${row.attempts.slice().reverse().map(a => `<p class="muted">${escapeHtml(formatDateTime(a.at))} · ${a.status === "sent" ? "발송 완료" : a.status === "failed" ? "발송 실패" : "결과 확인 필요"}</p>`).join("")}` : ""}</details>`;
  }).join("");
}
function renderDeliverySummary(summary) {
    document.querySelector("#deliveryTotal").textContent = summary.total;
    document.querySelector("#deliveryToday").textContent = `${summary.today}건`;
    document.querySelector("#deliveryLatest").textContent = formatDateTime(summary.latestAt);
    document.querySelector("#todayDeliveryCopy").textContent = `오늘 텔레그램 알림 ${summary.today}건 발송`;
    document.querySelector("#latestDeliveryCopy").textContent = `가장 최근 ${formatDateTime(summary.latestAt)} · 내역 확인`;
}
async function refreshDeliverySummary() {
  try { const data = await request("/api/deliveries?summary=1"); renderDeliverySummary(data.summary); }
  catch { document.querySelector("#todayDeliveryCopy").textContent = "오늘 발송 내역을 확인하지 못했습니다"; document.querySelector("#latestDeliveryCopy").textContent = "조회 결과에서 다시 시도하세요"; }
}
async function loadDeliveries(more = false) {
  const generation = ++historyGeneration;
  const rows = document.querySelector("#deliveryRows");
  const button = document.querySelector("#deliveryMore");
  const retry = document.querySelector("#deliveryRetry");
  button.disabled = true; retry.classList.add("hidden");
  if (!more) { historyOffset = null; button.classList.add("hidden"); rows.innerHTML = '<p class="history-empty">발송 내역을 불러오는 중이에요.</p>'; }
  document.querySelectorAll("[data-period]").forEach(el => el.classList.toggle("selected", el.dataset.period === historyPeriod));
  try {
    const data = await request(`/api/deliveries?${new URLSearchParams({ period: historyPeriod, status: historyStatus, offset: more ? historyOffset : 0 })}`);
    if (generation !== historyGeneration) return;
    renderDeliverySummary(data.summary);
    document.querySelector("#deliveryCount").textContent = `${data.total}건의 기록 · 발송 시각 최신순 · 한국 시간`;
    const markup = historyMarkup(data.items);
    if (more) rows.insertAdjacentHTML("beforeend", markup); else rows.innerHTML = markup || '<div class="history-empty">선택한 조건의 발송 내역이 없습니다.</div>';
    historyOffset = data.nextOffset;
    button.classList.toggle("hidden", historyOffset === null);
    document.querySelector("#deliveryScope").textContent = `보관된 기록 기준 누적 · 기록 시작 ${formatDateTime(data.summary.startedAt)} · 상세 기록 시작 ${formatDateTime(data.summary.detailedStartedAt)}. 메시지 1개 = 1건 · 실패 제외.${data.summary.uncertain ? ` 결과 확인이 필요한 발송 ${data.summary.uncertain}건은 집계에서 제외했습니다.` : ""}`;
  } catch {
    if (generation !== historyGeneration) return;
    if (!more) rows.innerHTML = '<p class="history-empty">발송 내역을 불러오지 못했습니다.</p>';
    document.querySelector("#todayDeliveryCopy").textContent = "오늘 발송 내역을 확인하지 못했습니다";
    document.querySelector("#latestDeliveryCopy").textContent = "조회 결과에서 다시 시도하세요";
    retry.classList.remove("hidden");
  } finally { if (generation === historyGeneration) button.disabled = false; }
}
await bootApp();
setInterval(async () => {
  if (currentUser) {
    const session = await loadSession();
    if (session.authenticated) {
      await loadWatches();
      await loadStatus();
      await refreshDeliverySummary();
    }
  }
}, 30_000);

// Only actual foreground interaction counts; background polling is excluded.
function trackVisit(pageView = false) {
  if (!currentUser || document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (!pageView && now - lastVisitPing < 60000) return;
  lastVisitPing = now;
  request('/api/analytics/visit', { method: 'POST', body: JSON.stringify({ pageView }) }).catch(() => {});
}
for (const type of ['pointerdown', 'keydown', 'scroll']) document.addEventListener(type, () => trackVisit(), { passive: true });
document.addEventListener('visibilitychange', () => trackVisit());
// Keep the navigation away from the software keyboard without changing form values.
if (window.visualViewport) {
  const updateKeyboard = () => document.body.classList.toggle('keyboard-open',
    /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && window.innerHeight - window.visualViewport.height > 140);
  window.visualViewport.addEventListener('resize', updateKeyboard);
  document.addEventListener('focusout', () => document.body.classList.remove('keyboard-open'));
}
