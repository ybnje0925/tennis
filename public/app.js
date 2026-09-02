import { formatKoreanDateWithWeekday } from "./dateFormat.js";
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
const connectTelegramButton = document.querySelector("#connectTelegram");
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
let gangdongTimeSlots = [];
let olympicTimeSlots = [];
let oneHourTimeSlots = [];
let venueGroups = { twoHour: [], oneHour: [] };
let venueOptions = [];
let venueNames = {};
let venuePublicUrls = {};
let providerPublicUrls = {};
let currentUser = null;

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
  renderLogs(status);
  buildInfoEl.textContent = `build ${shortCommit(status.buildCommit)} · scheduler ${status.schedulerVersion}`;
}

function renderLogs(status) {
  const logs = status.logs || [];
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
    .map((line, index) => ({ line, detail: details[index] || null }))
    .reverse()
    .forEach(({ line, detail }) => logsEl.append(createLogEntry(line, detail, status.providers || {})));
}

function createLogEntry(line, detail, providers) {
  const lines = String(line || "").split("\n").filter(Boolean);
  const summaryText = lines[0] || "-";
  const embeddedDetails = lines.slice(1);
  const fallbackErrors = fallbackProviderErrors(summaryText, providers);
  const hasDetails = embeddedDetails.length > 0 || fallbackErrors.length > 0 || detail?.errors?.length || detail?.facilities?.length || detail?.skippedProviders?.length;

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

  const errors = detail?.errors?.length ? detail.errors : fallbackErrors;
  if (errors.length > 0) body.append(renderErrorDetails(errors));
  if (detail?.facilities?.length) body.append(renderFacilityDetails(detail.facilities));
  if (detail?.skippedProviders?.length) body.append(renderSkippedProviderDetails(detail.skippedProviders));

  entry.append(body);
  return entry;
}

function renderErrorDetails(errors) {
  const section = document.createElement("section");
  section.className = "log-detail-block";
  section.append(logDetailTitle("문제 상세"));
  errors.forEach((error) => {
    const row = document.createElement("dl");
    row.className = "log-detail-grid";
    appendDetail(row, "시설", error.venueName || error.providerName || error.provider || "-");
    appendDetail(row, "날짜", error.targetDate || "-");
    appendDetail(row, "단계", error.stage || "-");
    appendDetail(row, "유형", error.type || "UNKNOWN");
    appendDetail(row, "원인", error.message || "-");
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

function fallbackProviderErrors(line, providers) {
  const labels = {
    gangdong: "강동",
    songpa: "송파",
    olympic: "올림픽",
    hanam: "하남"
  };
  return Object.entries(labels)
    .filter(([providerId, label]) => line.includes(label) && providers[providerId]?.lastError)
    .map(([providerId, label]) => ({
      provider: providerId,
      providerName: label,
      message: providers[providerId].lastError,
      type: "LAST_PROVIDER_ERROR",
      targetDate: null,
      stage: null
    }));
}

function shortCommit(value) {
  if (!value || value === "unknown") return "unknown";
  return String(value).slice(0, 7);
}

async function loadWatches() {
  const watches = await request("/api/watches");
  if (watches.length === 0) {
    watchesEl.innerHTML = `<p class="empty">등록된 알림이 없어 현재 계정은 조회 대상이 아닙니다.</p>`;
    return;
  }
  watchesEl.innerHTML = sortWatchesByReservationTime(watches)
    .map((watch) => {
      const venues = watch.venues.map((venue) => venueNames[venue] || venue).join(", ");
      const olympicDetail = watch.provider === "olympic"
        ? `<div>${watch.times.join("<br />")}</div>`
        : `<div>${watch.times.join("<br />")}</div>`;
      return `
        <article class="watch ${watch.enabled === false ? "disabled" : ""}">
          <div>
            <strong>${venues}</strong>
            <div>${formatDate(watch.date)}</div>
            ${olympicDetail}
            <div class="watch-state">${watch.enabled === true ? "감시 중" : "일시정지"}</div>
          </div>
          <div class="watch-actions">
            <button type="button" data-toggle="${watch.id}" data-enabled="${watch.enabled !== false}">
              ${watch.enabled === false ? "켜기" : "끄기"}
            </button>
            <button type="button" data-delete="${watch.id}">삭제</button>
          </div>
        </article>
      `;
    })
    .join("");
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
}

await bootApp();
setInterval(async () => {
  if (currentUser) {
    const session = await loadSession();
    if (session.authenticated) await loadStatus();
  }
}, 30_000);
