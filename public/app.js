const form = document.querySelector("#watchForm");
const statusEl = document.querySelector("#status");
const watchesEl = document.querySelector("#watches");
const timeSlotsEl = document.querySelector("#timeSlots");
const testToolsEl = document.querySelector("#testTools");
const logsEl = document.querySelector("#logs");
const lastCheckedEl = document.querySelector("#lastChecked");
const nextCheckEl = document.querySelector("#nextCheck");
const gangilStatusEl = document.querySelector("#gangilStatus");
const myeongilStatusEl = document.querySelector("#myeongilStatus");
const checkNowButton = document.querySelector("#checkNow");

const venueNames = {
  gangil: "강일테니스장",
  myeongil: "명일테니스장"
};

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
  timeSlotsEl.innerHTML = options.timeSlots
    .map((slot) => `<label><input type="checkbox" name="times" value="${slot}" /> ${slot}</label>`)
    .join("");
  testToolsEl.classList.toggle("hidden", !options.enableTestTools);
}

async function loadStatus() {
  const status = await request("/api/status");
  lastCheckedEl.textContent = formatDateTime(status.lastCheckedAt);
  nextCheckEl.textContent = formatDateTime(status.nextCheckAt);
  gangilStatusEl.textContent = status.venues?.gangil?.ok ? "조회 정상" : "대기 중";
  myeongilStatusEl.textContent = status.venues?.myeongil?.ok ? "조회 정상" : "대기 중";
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
      return `
        <article class="watch ${watch.enabled === false ? "disabled" : ""}">
          <div>
            <strong>${venues}</strong>
            <div>${formatDate(watch.date)}</div>
            <div>${watch.times.join("<br />")}</div>
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
    setStatus("알림 조건을 등록했습니다. 현재 빈자리가 있으면 1회 알려드립니다.");
    await loadWatches();
    await loadStatus();
  } catch (error) {
    setStatus(error.message);
  }
});

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
await loadWatches();
await loadStatus();
setInterval(loadStatus, 30_000);
