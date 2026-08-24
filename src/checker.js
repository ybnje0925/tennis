import { openGangdongSession, ensureLoggedIn, looksLikeProtectionOrLogin } from "./browserSession.js";
import { PROVIDERS, VENUES } from "./constants.js";
import { config } from "./config.js";
import { parseReservationDom } from "./parser.js";
import { checkOlympicByWatches, isOlympicWatch } from "./providers/olympicProvider.js";
import { checkSongpaVenues, songpaVenueIdsFromWatches } from "./providers/songpaProvider.js";
import { fileURLToPath } from "node:url";

const providerLocks = new Map();
export const CHECK_META = Symbol.for("tennis.checkMeta");

export async function checkVenue(page, venueId, options = {}) {
  const venue = VENUES[venueId];
  if (!venue) throw new Error(`Unknown venue: ${venueId}`);

  await page.goto(venue.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  if (await looksLikeProtectionOrLogin(page)) {
    throw new Error(`${venue.name} 예약현황이 실제 달력이 아니라 로그인/보호 페이지로 보입니다.`);
  }

  const reservations = await parseReservationDom(page, venueId);
  if (reservations.length === 0) {
    throw new Error(`${venue.name} 예약현황 DOM에서 예약 데이터를 찾지 못했습니다.`);
  }

  if (!options.dates || options.dates.length === 0) return reservations;
  const neededDates = new Set(options.dates);
  return reservations.filter((item) => neededDates.has(item.date));
}

export async function checkGangdongVenues(venueIds, options = {}) {
  const ids = venueIds.filter((venueId) => VENUES[venueId]?.provider === "gangdong");
  if (ids.length === 0) return {};

  const { context, page } = await openGangdongSession();
  try {
    const loggedIn = await ensureLoggedIn(page);
    if (!loggedIn) throw new Error("로그인 완료 여부를 확인하지 못했습니다.");

    const result = {};
    const errors = [];
    for (const venueId of ids) {
      try {
        result[venueId] = await checkVenue(page, venueId, { dates: options.venueDates?.[venueId] });
      } catch (error) {
        errors.push({ provider: "gangdong", venueId, message: error.message });
        console.warn(`강동: ${VENUES[venueId]?.name || venueId} 조회 실패`);
      }
    }
    return withCheckMeta(result, { errors });
  } finally {
    await context.close();
  }
}

export async function checkAllVenues(options = {}) {
  const watches = options.watches || [];
  if (watches.length === 0 && options.requireWatches) return {};

  const watchedVenueIds = new Set(
    watches.length > 0
      ? watches.flatMap((watch) => watch.venues || (watch.venue ? [watch.venue] : []))
      : Object.keys(VENUES).filter((venueId) => VENUES[venueId].provider !== "olympic")
  );

  const result = {};
  const venueDates = buildVenueDateTargets(watches);
  const meta = { errors: [] };
  const gangdong = await safeProviderCheck("gangdong", () => checkGangdongVenues(Array.from(watchedVenueIds), { venueDates }));
  Object.assign(result, stripCheckMeta(gangdong));
  meta.errors.push(...getCheckErrors(gangdong));

  const songpa = await safeProviderCheck("songpa", () => checkSongpaVenues(songpaVenueIdsFromWatches(watches)));
  Object.assign(result, stripCheckMeta(songpa));
  meta.errors.push(...getCheckErrors(songpa));

  const olympicWatches = watches.filter(isOlympicWatch);
  if (olympicWatches.length > 0 && config.enableOlympicProvider) {
    const olympicResult = await safeProviderCheck("olympic", () => checkOlympicByWatches(olympicWatches));
    meta.errors.push(...getCheckErrors(olympicResult));
    if (olympicResult) result.olympic = olympicResult;
  }
  return withCheckMeta(result, meta);
}

export async function runProviderCheck(providerId, fn) {
  if (providerLocks.has(providerId)) {
    console.debug(`${providerId} check already running; duplicate check skipped.`);
    return withCheckMeta(providerId === "olympic" ? [] : {}, {
      errors: [{ provider: providerId, message: "중복조회 생략" }]
    });
  }

  const running = Promise.resolve().then(fn);
  providerLocks.set(providerId, running);
  try {
    return await running;
  } finally {
    if (providerLocks.get(providerId) === running) providerLocks.delete(providerId);
  }
}

async function safeProviderCheck(providerId, fn) {
  try {
    return await runProviderCheck(providerId, fn);
  } catch (error) {
    console.error(`${PROVIDERS[providerId]?.name || providerId} 조회 실패: ${error.message}`);
    return withCheckMeta(providerId === "olympic" ? [] : {}, {
      errors: [{ provider: providerId, message: error.message }]
    });
  }
}

function withCheckMeta(result, meta) {
  Object.defineProperty(result, CHECK_META, {
    value: meta,
    enumerable: false,
    configurable: true
  });
  return result;
}

function stripCheckMeta(result) {
  if (!result || typeof result !== "object") return result;
  const clone = Array.isArray(result) ? result.slice() : { ...result };
  return clone;
}

function getCheckErrors(result) {
  return result?.[CHECK_META]?.errors || [];
}

export function buildVenueDateTargets(watches) {
  const targets = {};
  for (const watch of watches) {
    if (watch.enabled !== true) continue;
    for (const venueId of watch.venues || []) {
      if (!targets[venueId]) targets[venueId] = new Set();
      targets[venueId].add(watch.date);
    }
  }
  return Object.fromEntries(
    Object.entries(targets).map(([venueId, dates]) => [venueId, Array.from(dates).sort()])
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  checkAllVenues()
    .then((result) => {
      for (const [venueId, items] of Object.entries(result)) {
        console.log(`${VENUES[venueId].name}: ${items.length} items`);
        console.log(items.slice(0, 5));
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
