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
const gangilStatusEl = document.querySelector("#gangilStatus");
const myeongilStatusEl = document.querySelector("#myeongilStatus");
const olympicStatusEl = document.querySelector("#olympicStatus");
const songpaStatusEl = document.querySelector("#songpaStatus");
const reservationLinks = {
  gangil: document.querySelector("#gangilLink"),
  myeongil: document.querySelector("#myeongilLink"),
  olympic: document.querySelector("#olympicLink"),
  songpa: document.querySelector("#songpaLink")
};
const venueGroupsEl = document.querySelector("#venueGroups");
const venueSelectionHelpEl = document.querySelector("#venueSelectionHelp");
let gangdongTimeSlots = [];
let olympicTimeSlots = [];
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
    hour12: false
  }).format(new Date(value));
}

function formatProviderStatus(status, providerId, active) {
  if (!active) return "미사용";
  const provider = status.providers?.[providerId] || {};
  return `감시 중 · ${formatDateTime(provider.lastCheckedAt)} → ${formatDateTime(provider.nextCheckAt)}`;
}

function formatAggregateCheckTime(status, key) {
  if (status[key]) return formatDateTime(status[key]);
  const activeProviders = Object.values(status.providers || {}).filter((provider) => provider.active);
  return activeProviders.length > 1 ? "provider별 확인" : "-";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

async function loadOptions() {
  const options = await request("/api/options");
  gangdongTimeSlots = options.timeSlots;
  olympicTimeSlots = options.olympicTimeSlots;
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
    songpa: providerPublicUrls.songpa
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
  lastCheckedEl.textContent = formatAggregateCheckTime(status, "lastCheckedAt");
  nextCheckEl.textContent = formatAggregateCheckTime(status, "nextCheckAt");
  const gangdongActive = Boolean(status.activeVenues?.gangil || status.activeVenues?.myeongil);
  const songpaActive = ["songpa-oryun", "songpa-seongnaecheon", "songpa-songpa", "songpa-ogeum"].some((id) => status.activeVenues?.[id]);
  gangilStatusEl.textContent = formatProviderStatus(status, "gangdong", gangdongActive);
  myeongilStatusEl.textContent = formatProviderStatus(status, "gangdong", gangdongActive);
  olympicStatusEl.textContent = formatProviderStatus(status, "olympic", status.activeVenues?.olympic);
  songpaStatusEl.textContent = formatProviderStatus(status, "songpa", songpaActive);
  logsEl.innerHTML = (status.logs || []).length
    ? status.logs.slice().reverse().map((line) => `<div>${line}</div>`).join("")
    : `<p class="empty">아직 로그가 없습니다.</p>`;
}

async function loadWatches() {
  const watches = await request("/api/watches");
  if (watches.length === 0) {
    watchesEl.innerHTML = `<p class="empty">아직 등록된 알림 조건이 없습니다.</p>`;
    return;
  }
  watchesEl.innerHTML = watches
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
  const olympicSelected = data.getAll("venues").includes("olympic");
  const selectedSlotMinutes = getSelectedSlotMinutes(data.getAll("venues"));
  for (const input of form.querySelectorAll("input[name='venues']")) {
    const slotMinutes = Number(input.dataset.slotMinutes);
    input.disabled = Boolean(selectedSlotMinutes && slotMinutes !== selectedSlotMinutes && !input.checked);
  }

  if (selectedSlotMinutes === 120) {
    venueSelectionHelpEl.textContent = "예약단위가 다른 테니스장은 함께 선택할 수 없습니다.";
  } else if (selectedSlotMinutes === 60) {
    venueSelectionHelpEl.textContent = "올림픽공원은 1시간 단위 예약 시설입니다. 2시간 단위 시설과 별도로 알림을 등록해주세요.";
  } else {
    venueSelectionHelpEl.textContent = "";
  }

  timeSlotsLegendEl.textContent = olympicSelected ? "올림픽공원 시간대" : "시간대";
  renderTimeSlots(olympicSelected ? olympicTimeSlots : gangdongTimeSlots);
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
