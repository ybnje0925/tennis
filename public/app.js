const form = document.querySelector("#watchForm");
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
const checkNowButton = document.querySelector("#checkNow");
const venueGroupsEl = document.querySelector("#venueGroups");
const venueSelectionHelpEl = document.querySelector("#venueSelectionHelp");
let gangdongTimeSlots = [];
let olympicTimeSlots = [];
let venueGroups = { twoHour: [], oneHour: [] };
let venueOptions = [];

let venueNames = {};

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
  renderVenueGroups();
  renderTimeSlots(gangdongTimeSlots);
  testToolsEl.classList.toggle("hidden", !options.enableTestTools);
}

async function loadStatus() {
  const status = await request("/api/status");
  lastCheckedEl.textContent = formatDateTime(status.lastCheckedAt);
  nextCheckEl.textContent = formatDateTime(status.nextCheckAt);
  gangilStatusEl.textContent = status.venues?.gangil?.ok ? "조회 정상" : "대기 중";
  myeongilStatusEl.textContent = status.venues?.myeongil?.ok ? "조회 정상" : "대기 중";
  olympicStatusEl.textContent = status.venues?.olympic?.ok ? "조회 정상" : "대기 중";
  songpaStatusEl.textContent = ["songpa-oryun", "songpa-seongnaecheon", "songpa-songpa", "songpa-ogeum"].some((id) => status.venues?.[id]?.ok)
    ? "조회 정상"
    : "대기 중";
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
      const venues = watch.venues.map((venue) => venueNames[venue]).join(", ");
      const olympicDetail = watch.provider === "olympic"
        ? `<div>${watch.times.join("<br />")}</div>`
        : `<div>${watch.times.join("<br />")}</div>`;
      return `
        <article class="watch ${watch.enabled === false ? "disabled" : ""}">
          <div>
            <strong>${venues}</strong>
            <div>${formatDate(watch.date)}</div>
            ${olympicDetail}
            <div class="watch-state">${watch.enabled === false ? "알림 꺼짐" : "알림 대기 중"}</div>
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

checkNowButton.addEventListener("click", async () => {
  setStatus("예약현황을 확인하는 중입니다.");
  checkNowButton.disabled = true;
  try {
    const result = await request("/api/check-now", { method: "POST", body: "{}" });
    setStatus(`확인 완료: ${result.reservationCount}개 항목, 알림 ${result.notificationCount}건`);
    await loadStatus();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setTimeout(() => {
      checkNowButton.disabled = false;
    }, 45_000);
  }
});

document.querySelector("#fakeAvailability").addEventListener("click", async () => {
  try {
    const result = await request("/api/test/fake-availability", { method: "POST", body: "{}" });
    setStatus(`테스트 완료: 알림 ${result.notificationCount}건`);
  } catch (error) {
    setStatus(error.message);
  }
});

await loadOptions();
updateVenueSelection();
await loadWatches();
await loadStatus();
setInterval(loadStatus, 30_000);
