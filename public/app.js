const form = document.querySelector("#watchForm");
const statusEl = document.querySelector("#status");
const watchesEl = document.querySelector("#watches");
const timeSlotsEl = document.querySelector("#timeSlots");
const testToolsEl = document.querySelector("#testTools");

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

async function loadOptions() {
  const options = await request("/api/options");
  timeSlotsEl.innerHTML = options.timeSlots
    .map((slot) => `<label><input type="checkbox" name="times" value="${slot}" /> ${slot}</label>`)
    .join("");
  testToolsEl.classList.toggle("hidden", !options.enableTestTools);
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
        <article class="watch">
          <div>
            <strong>${venues}</strong>
            <div>${watch.date}</div>
            <div>${watch.times.join(", ")}</div>
          </div>
          <button type="button" data-delete="${watch.id}">삭제</button>
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
    setStatus("알림 조건을 등록했습니다. 이미 빈자리가 있으면 다음 확인 때 1회 알려드립니다.");
    await loadWatches();
  } catch (error) {
    setStatus(error.message);
  }
});

watchesEl.addEventListener("click", async (event) => {
  const id = event.target?.dataset?.delete;
  if (!id) return;
  await request(`/api/watches/${id}`, { method: "DELETE" });
  await loadWatches();
});

document.querySelector("#checkNow").addEventListener("click", async () => {
  setStatus("예약현황을 확인하는 중입니다.");
  try {
    const result = await request("/api/check-now", { method: "POST", body: "{}" });
    setStatus(`확인 완료: ${result.reservationCount}개 항목, 알림 ${result.notificationCount}건`);
  } catch (error) {
    setStatus(error.message);
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
