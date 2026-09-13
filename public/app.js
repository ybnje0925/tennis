import { formatKoreanDateWithWeekday, isDateBeforeKstToday } from "./dateFormat.js";
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
const hanamStatusEl = document.querySelector("#hanamStatus");
const reservationLinks = {
  gangil: document.querySelector("#gangilLink"),
  myeongil: document.querySelector("#myeongilLink"),
  olympic: document.querySelector("#olympicLink"),
  songpa: document.querySelector("#songpaLink"),
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
let venueGroups = { twoHour: [], oneHour: [] };
let venueOptions = [];
let venueNames = {};
let venuePublicUrls = {};
let providerPublicUrls = {};
let currentUser = null;
let seoulAreas = [];
let displayedWatches = [];
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
  venueGroups = options.venueGroups;
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
  form.querySelector("button[type='submit']").disabled = !currentUser?.telegramConnected;
  if (session.authenticated && !currentUser.telegramConnected) {
    setStatus("텔레그램 연결 후 알림을 등록할 수 있습니다.");
  }
  return session;
}

function updateReservationLinks() {
  const links = {
    gangil: venuePublicUrls.gangil,
    myeongil: venuePublicUrls.myeongil,
    olympic: venuePublicUrls.olympic,
    songpa: providerPublicUrls.songpa,
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
  hanamStatusEl.textContent = formatProviderStatus(status, "hanam", hanamActive);
  const activeWatchCount = displayActiveWatchCount ?? Number(status.currentUserActiveWatchCount || 0);
  monitoringTitleEl.textContent = activeWatchCount > 0 ? "모니터링 중" : "모니터링 대기 중";
  monitoringDescriptionEl.textContent = activeWatchCount > 0
    ? "선택한 시설의 잔여 코트를 주기적으로 확인하고 있어요."
    : "알림 조건을 등록하면 5분 간격으로 빈자리를 확인해요.";
  renderLogs(status);
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
  const labels = { gangdong: "강동", songpa: "송파", olympic: "올림픽", hanam: "하남" };
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
  section.append(logDetailTitle("시설별 처리 상태"));
  facilities.forEach((facility) => {
    const row = document.createElement("p");
    row.textContent = `${facility.venueName || facility.venueId}: ${facilityStatusLabel(facility.status)} · 결과 ${facility.count ?? 0}건`;
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
}

function renderWatches(watches) {
  const expiredWatches = watches.filter((watch) => isExpiredWatchDate(watch.date));
  const activeWatches = watches.filter((watch) => watch.enabled !== false && !isExpiredWatchDate(watch.date));
  displayActiveWatchCount = activeWatches.length;
  const connectedVenues = new Set(activeWatches.flatMap((watch) => watch.venues || []));
  activeWatchCountEl.textContent = String(activeWatches.length);
  connectedVenueCountEl.textContent = String(connectedVenues.size);
  watchSummaryEl.textContent = watchSummaryText(activeWatches.length, expiredWatches.length);
  if (watches.length === 0) {
    watchesEl.innerHTML = `<p class="empty">등록된 알림이 없어 현재 계정은 조회 대상이 아닙니다.</p>`;
    return;
  }
  const sortedWatches = sortWatchesByReservationTime(watches);
  const groups = [
    { title: "활성 알림", description: "빈자리를 확인 중인 알림", watches: sortedWatches.filter((watch) => watch.enabled !== false && !isExpiredWatchDate(watch.date)), open: true },
    { title: "일시정지", description: "현재 조회하지 않는 알림", watches: sortedWatches.filter((watch) => watch.enabled === false && !isExpiredWatchDate(watch.date)), open: false },
    { title: "만료된 알림", description: "지난 날짜의 알림", watches: sortedWatches.filter((watch) => isExpiredWatchDate(watch.date)), open: false }
  ].filter((group) => group.watches.length > 0);
  watchesEl.innerHTML = groups.map((group) => `
    <details class="watch-group" ${group.open ? "open" : ""}>
      <summary><span><strong>${group.title}</strong><small>${group.description}</small></span><span class="watch-group-count">${group.watches.length}개</span></summary>
      <div class="watch-group-items">${group.watches.map(renderWatchCard).join("")}</div>
    </details>
  `).join("");
}

function renderWatchCard(watch) {
      const venues = watch.venues.map((venue) => venueNames[venue] || venue).join(", ");
      const date = formatWatchDate(watch.date);
      const timeLabels = watch.times.map((time) => `<span>${time}</span>`).join("");
      const expired = isExpiredWatchDate(watch.date);
      const state = expired ? "만료됨" : watch.enabled === false ? "일시정지" : "알림 켜짐";
      return `
        <details class="watch ${expired ? "expired" : watch.enabled === false ? "disabled" : ""}" ${expired ? "" : "open"}>
          <summary class="watch-summary">
            <div class="watch-main">
              <div class="watch-date">
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
            <p>${expired ? "지난 날짜의 알림입니다. 필요하지 않다면 삭제해 주세요." : "알림 조건을 일시정지하거나 다시 켤 수 있어요."}</p>
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
    times: data.getAll("times")
  };
  try {
    await request("/api/watches", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    updateOlympicFields();
    setStatus("알림 조건을 등록했습니다. 현재 빈자리가 있으면 1회 알려드립니다.");
    await loadWatches();
    await loadStatus();
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
  const selectedSlotMinutes = getSelectedSlotMinutes(data.getAll("venues"));
  for (const input of form.querySelectorAll("input[name='venues']")) {
    const slotMinutes = Number(input.dataset.slotMinutes);
    input.disabled = Boolean(selectedSlotMinutes && slotMinutes !== selectedSlotMinutes && !input.checked);
  }

  if (selectedSlotMinutes === 120) {
    venueSelectionHelpEl.textContent = "예약단위가 다른 테니스장은 함께 선택할 수 없습니다.";
  } else if (selectedSlotMinutes === 60) {
    venueSelectionHelpEl.textContent = "1시간 단위 예약 시설입니다. 2시간 단위 시설과 별도로 알림을 등록해주세요.";
  } else {
    venueSelectionHelpEl.textContent = "";
  }

  timeSlotsLegendEl.textContent = selectedSlotMinutes === 60 ? "1시간 단위 시간대" : "시간대";
  renderTimeSlots(selectedSlotMinutes === 60 ? oneHourTimeSlots : gangdongTimeSlots);
}

function renderVenueGroups() {
  venueGroupsEl.innerHTML = [
    renderVenueGroup("2시간 예약", venueGroups.twoHour || []),
    renderVenueGroup("1시간 예약", venueGroups.oneHour || [])
  ].join("");
}

function renderVenueGroup(title, venues) {
  return `
    <div class="venue-group">
      <div class="venue-group-title">${title}</div>
      ${venues.map((venue) => `
        <label class="venue-option">
          <input type="checkbox" name="venues" value="${venue.id}" data-slot-minutes="${venue.slotMinutes}" />
          <span class="venue-name">${venue.name}</span>
          <span class="venue-unit">(${venue.slotMinutes / 60}시간)</span>
        </label>
      `).join("")}
    </div>
  `;
}

function getSelectedSlotMinutes(selectedVenueIds) {
  const selected = venueOptions.filter((venue) => selectedVenueIds.includes(venue.id));
  const groups = new Set(selected.map((venue) => venue.slotMinutes));
  return groups.size === 1 ? Array.from(groups)[0] : null;
}

function renderTimeSlots(slots) {
  const selected = new Set(new FormData(form).getAll("times"));
  timeSlotsEl.innerHTML = slots
    .map((slot) => `<label><input type="checkbox" name="times" value="${slot}" ${selected.has(slot) ? "checked" : ""} /> ${slot}</label>`)
    .join("");
}

watchesEl.addEventListener("click", async (event) => {
  const deleteId = event.target?.dataset?.delete;
  const toggleId = event.target?.dataset?.toggle;
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
  form.scrollIntoView({ behavior: "smooth", block: "start" });
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
  await loadOptions();
  updateVenueSelection();
  await loadWatches();
  await loadStatus();
  await loadSeoulCatalog().catch((error) => {
    seoulCatalogStatusEl.textContent = error.message;
  });
}

await bootApp();
setInterval(async () => {
  if (currentUser) {
    const session = await loadSession();
    if (session.authenticated) {
      renderWatches(displayedWatches);
      await loadStatus();
    }
  }
}, 30_000);
