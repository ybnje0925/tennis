import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { OLYMPIC_TIME_SLOTS, PROVIDERS, TIME_SLOTS, VENUES } from "./constants.js";
import {
  addWatch,
  claimInviteCode,
  connectTelegramLinkToken,
  createTelegramLinkToken,
  deleteWatch,
  getUserBySessionToken,
  loadState,
  saveState,
  updateWatch
} from "./storage.js";
import { sendTelegramMessage } from "./telegramNotifier.js";
import {
  buildVenueDateTargets,
  getActiveWatches,
  groupActiveWatchesByVenue,
  runCheckCycle,
  startScheduler
} from "./monitor.js";
import { validateVenueSelection } from "./venueRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.resolve(__dirname, "..", "public")));

const SESSION_COOKIE = "tennis_session";

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 180 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    telegramConnected: Boolean(user.telegramConnected),
    enabled: user.enabled !== false
  };
}

async function requireUser(req, res, next) {
  try {
    const token = parseCookies(req)[SESSION_COOKIE] || bearerToken(req);
    const user = await getUserBySessionToken(token);
    if (!user) return res.status(401).json({ error: "초대 인증이 필요합니다." });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function requireAdmin(req, res, next) {
  if (!config.adminApiToken || req.headers["x-admin-token"] !== config.adminApiToken) {
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/options", requireUser, (req, res) => {
  res.json({
    venues: Object.values(VENUES).map(({ id, name, provider, slotMinutes, publicUrl }) => ({ id, name, provider, slotMinutes, publicUrl })),
    venueGroups: {
      twoHour: Object.values(VENUES).filter((venue) => venue.slotMinutes === 120).map(({ id, name, slotMinutes, publicUrl }) => ({ id, name, slotMinutes, publicUrl })),
      oneHour: Object.values(VENUES).filter((venue) => venue.slotMinutes === 60).map(({ id, name, slotMinutes, publicUrl }) => ({ id, name, slotMinutes, publicUrl }))
    },
    providers: PROVIDERS,
    timeSlots: TIME_SLOTS,
    olympicTimeSlots: OLYMPIC_TIME_SLOTS,
    enableTestTools: config.enableTestTools
  });
});

app.get("/api/session", async (req, res, next) => {
  try {
    const token = parseCookies(req)[SESSION_COOKIE] || bearerToken(req);
    const user = await getUserBySessionToken(token);
    res.json({ authenticated: Boolean(user), user: user ? publicUser(user) : null });
  } catch (error) {
    next(error);
  }
});

app.post("/api/invite/claim", async (req, res, next) => {
  try {
    const { code, name } = req.body || {};
    const { user, token } = await claimInviteCode({ code, name });
    setSessionCookie(res, token);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/telegram/link-token", requireUser, async (req, res, next) => {
  try {
    if (!config.telegramBotUsername) throw new Error("TELEGRAM_BOT_USERNAME is not configured.");
    const token = await createTelegramLinkToken(req.user.id);
    res.json({
      url: `https://t.me/${config.telegramBotUsername}?start=${encodeURIComponent(token)}`
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/telegram/webhook", async (req, res, next) => {
  try {
    const message = req.body?.message;
    const chatId = message?.chat?.id;
    const text = String(message?.text || "");
    const token = text.match(/^\/start\s+(.+)$/)?.[1]?.trim();
    if (!chatId || !token) return res.json({ ok: true });

    const user = await connectTelegramLinkToken(token, chatId);
    if (user) {
      await sendTelegramMessage([
        "🎾 테니스 잡아줘",
        "",
        "텔레그램 알림 연결이 완료되었습니다.",
        "이제 원하는 코트와 날짜, 시간대를 등록해주세요."
      ].join("\n"), { chatId: String(chatId) });
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/watches", requireUser, async (req, res, next) => {
  try {
    const state = await loadState();
    res.json(state.watches.filter((watch) => watch.userId === req.user.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/status", requireUser, async (req, res, next) => {
  try {
    const state = await loadState();
    const activeByVenue = groupActiveWatchesByVenue(getActiveWatches(state));
    res.json({
      ...state.system,
      activeVenues: Object.fromEntries(
        Object.keys(VENUES).map((venueId) => [
          venueId,
          activeByVenue[venueId]?.length > 0 && (VENUES[venueId].provider !== "olympic" || config.enableOlympicProvider)
        ])
      )
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/watches", requireUser, async (req, res, next) => {
  try {
    if (!req.user.telegramConnected || !req.user.telegramChatId) {
      return res.status(403).json({ error: "텔레그램 연결 후 알림을 등록할 수 있습니다." });
    }
    const { venues, date, times } = req.body;
    const venueValidation = validateVenueSelection(venues);
    if (!venueValidation.ok) throw new Error(venueValidation.message);
    if (!date) throw new Error("날짜를 선택하세요.");
    const includesOlympic = venues.includes("olympic");
    if (includesOlympic) {
      if (!Array.isArray(times) || times.length === 0) throw new Error("올림픽공원 시간대를 선택하세요.");
      for (const time of times) {
        if (!OLYMPIC_TIME_SLOTS.includes(time)) throw new Error("올림픽공원 시간대 형식이 올바르지 않습니다.");
      }
    } else if (!Array.isArray(times) || times.length === 0) {
      throw new Error("시간대를 선택하세요.");
    }
    const provider = VENUES[venues[0]]?.provider;
    const watch = await addWatch({
      userId: req.user.id,
      provider,
      venue: includesOlympic ? "olympic" : undefined,
      venues,
      date,
      times
    });
    res.status(201).json({ watch });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/watches/:id", requireUser, async (req, res, next) => {
  try {
    const watch = await updateWatch(req.params.id, req.body, req.user.id);
    res.json(watch);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/watches/:id", requireUser, async (req, res, next) => {
  try {
    await deleteWatch(req.params.id, req.user.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/check-now", requireAdmin, async (req, res, next) => {
  try {
    const state = await loadState();
    const activeByVenue = groupActiveWatchesByVenue(getActiveWatches(state));
    const activeVenueIds = Object.keys(buildVenueDateTargets(activeByVenue)).filter((venueId) => (
      VENUES[venueId]?.provider !== "olympic" || config.enableOlympicProvider
    ));
    if (activeVenueIds.length === 0) {
      return res.json({
        checkedAt: null,
        reservationCount: 0,
        notificationCount: 0,
        errors: [],
        message: "활성화된 알림 조건이 없습니다.",
        sample: []
      });
    }

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

    const result = await runCheckCycle({ source: "manual" });
    res.json({
      checkedAt: result.checkedAt,
      reservationCount: result.reservations.length,
      notificationCount: result.notifications.length,
      errors: result.errors,
      message: result.skipped ? "활성화된 알림 조건이 없습니다." : null,
      sample: result.reservations.slice(0, 5)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/test/fake-availability", requireAdmin, async (req, res, next) => {
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
