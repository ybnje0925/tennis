import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { TIME_SLOTS, VENUES } from "./constants.js";
import { addWatch, deleteWatch, loadState, saveState, updateWatch } from "./storage.js";
import { runCheckCycle, startScheduler } from "./monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.resolve(__dirname, "..", "public")));

app.get("/api/options", (req, res) => {
  res.json({
    venues: Object.values(VENUES).map(({ id, name }) => ({ id, name })),
    timeSlots: TIME_SLOTS,
    enableTestTools: config.enableTestTools
  });
});

app.get("/api/watches", async (req, res, next) => {
  try {
    const state = await loadState();
    res.json(state.watches);
  } catch (error) {
    next(error);
  }
});

app.get("/api/status", async (req, res, next) => {
  try {
    const state = await loadState();
    res.json(state.system);
  } catch (error) {
    next(error);
  }
});

app.post("/api/watches", async (req, res, next) => {
  try {
    const { venues, date, times } = req.body;
    if (!Array.isArray(venues) || venues.length === 0) throw new Error("테니스장을 선택하세요.");
    if (!date) throw new Error("날짜를 선택하세요.");
    if (!Array.isArray(times) || times.length === 0) throw new Error("시간대를 선택하세요.");
    const watch = await addWatch({ venues, date, times });
    const immediate = await runCheckCycle().catch((error) => ({ errors: [error.message] }));
    res.status(201).json({ watch, immediate });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/watches/:id", async (req, res, next) => {
  try {
    const watch = await updateWatch(req.params.id, req.body);
    res.json(watch);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/watches/:id", async (req, res, next) => {
  try {
    await deleteWatch(req.params.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/check-now", async (req, res, next) => {
  try {
    const state = await loadState();
    const now = Date.now();
    const lastManual = state.system.lastManualCheckAt ? Date.parse(state.system.lastManualCheckAt) : 0;
    const cooldownMs = 45_000;
    if (lastManual && now - lastManual < cooldownMs) {
      return res.status(429).json({
        error: `지금 확인은 ${Math.ceil((cooldownMs - (now - lastManual)) / 1000)}초 후 다시 시도하세요.`
      });
    }
    state.system.lastManualCheckAt = new Date(now).toISOString();
    await saveState(state);

    const result = await runCheckCycle();
    res.json({
      checkedAt: result.checkedAt,
      reservationCount: result.reservations.length,
      notificationCount: result.notifications.length,
      errors: result.errors,
      sample: result.reservations.slice(0, 5)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/test/fake-availability", async (req, res, next) => {
  try {
    if (!config.enableTestTools) return res.status(404).json({ error: "Not found" });
    const state = await loadState();
    const watch = state.watches[0];
    if (!watch) return res.status(400).json({ error: "등록된 알림 조건이 없습니다." });
    const item = {
      venue: watch.venues[0],
      venueName: VENUES[watch.venues[0]].name,
      date: watch.date,
      time: watch.times[0],
      available: true,
      availableCount: 1
    };
    const result = await runCheckCycle({ checker: async () => ({ [item.venue]: [item] }) });
    res.json({ notificationCount: result.notifications.length, item });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(400).json({ error: error.message });
});

app.listen(config.port, () => {
  console.log(`테니스 잡아줘 is running at http://localhost:${config.port}`);
});

startScheduler();
