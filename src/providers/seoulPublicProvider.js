import { config } from "../config.js";
import { diagnosticError } from "../diagnostics.js";

const API_HOST = "http://openapi.seoul.go.kr:8088";
const API_SERVICE = "ListPublicReservationSport";
const API_FORMAT = "json";
const TENNIS_QUERY = "테니스장";
const DEFAULT_LIMIT = 1000;
const DEFAULT_TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 10 * 60 * 1000;

const RAW_FIELDS = [
  "SVCID",
  "SVCNM",
  "MAXCLASSNM",
  "MINCLASSNM",
  "SVCSTATNM",
  "PAYATNM",
  "PLACENM",
  "USETGTINFO",
  "SVCURL",
  "X",
  "Y",
  "SVCOPNBGNDT",
  "SVCOPNENDDT",
  "RCPTBGNDT",
  "RCPTENDDT",
  "AREANM",
  "TELNO",
  "V_MIN",
  "V_MAX",
  "REVSTDDAY"
];

let cache = null;

export async function fetchSeoulTennisServices(options = {}) {
  const now = options.now || (() => new Date());
  const at = now();
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && isFreshCache(cache, at)) {
    return catalogResponse(cache, { cached: true, stale: false });
  }

  try {
    const catalog = await fetchFreshCatalog({ ...options, now });
    cache = catalog;
    return catalogResponse(catalog, { cached: false, stale: false });
  } catch (error) {
    if (cache) {
      return catalogResponse(cache, {
        cached: true,
        stale: true,
        warning: "서울시 API 조회 실패로 이전 catalog를 표시합니다."
      });
    }
    throw error;
  }
}

export function filterSeoulTennisCatalog(catalog, filters = {}) {
  const q = normalizeSearch(filters.q);
  const area = normalizeSearch(filters.area);
  const status = normalizeSearch(filters.status);

  const services = (catalog.services || []).filter((service) => {
    if (q && !normalizeSearch(`${service.placeName} ${service.serviceName}`).includes(q)) return false;
    if (area && normalizeSearch(service.areaName) !== area) return false;
    if (status && normalizeSearch(service.status) !== status) return false;
    return true;
  });
  const places = groupSeoulTennisPlaces(services);

  return {
    ...catalog,
    totalServiceCount: services.length,
    uniquePlaceCount: places.length,
    services,
    places
  };
}

export function normalizeSeoulTennisService(row = {}) {
  const raw = Object.fromEntries(RAW_FIELDS.map((field) => [field, normalizeRawValue(row[field])]));
  return {
    serviceId: raw.SVCID,
    serviceName: raw.SVCNM,
    placeName: raw.PLACENM,
    areaName: raw.AREANM,
    status: raw.SVCSTATNM,
    paymentType: raw.PAYATNM,
    categoryMajor: raw.MAXCLASSNM,
    categoryMinor: raw.MINCLASSNM,
    targetInfo: raw.USETGTINFO,
    reservationUrl: raw.SVCURL,
    latitude: parseCoordinate(raw.Y),
    longitude: parseCoordinate(raw.X),
    serviceOpenAt: raw.SVCOPNBGNDT,
    serviceCloseAt: raw.SVCOPNENDDT,
    receptionOpenAt: raw.RCPTBGNDT,
    receptionCloseAt: raw.RCPTENDDT,
    phone: raw.TELNO,
    minPeople: parseInteger(raw.V_MIN),
    maxPeople: parseInteger(raw.V_MAX),
    reservationStandardDay: raw.REVSTDDAY,
    raw
  };
}

export function groupSeoulTennisPlaces(services = []) {
  const byPlace = new Map();
  for (const service of services) {
    const areaName = service.areaName || "지역 미상";
    const placeName = service.placeName || service.serviceName || "장소 미상";
    const placeKey = `${areaName}|${placeName}`;
    if (!byPlace.has(placeKey)) {
      byPlace.set(placeKey, {
        placeKey,
        areaName,
        placeName,
        serviceCount: 0,
        services: []
      });
    }
    const place = byPlace.get(placeKey);
    place.services.push(service);
    place.serviceCount = place.services.length;
  }

  return Array.from(byPlace.values()).sort((a, b) => (
    `${a.areaName} ${a.placeName}`.localeCompare(`${b.areaName} ${b.placeName}`, "ko")
  ));
}

export function resetSeoulPublicCache() {
  cache = null;
}

async function fetchFreshCatalog(options) {
  const apiKey = options.apiKey ?? config.seoulOpenApiKey;
  if (!apiKey) throw seoulError("CONFIG_MISSING", "CONFIG", "SEOUL_OPEN_API_KEY가 설정되어 있지 않습니다.", false);

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw seoulError("CONFIG_MISSING", "CONFIG", "fetch를 사용할 수 없습니다.", false);

  const fetchedAt = options.now().toISOString();
  const response = await fetchWithTimeout(
    buildSeoulApiUrl(apiKey, options),
    {
      headers: { "user-agent": "tennis-jabajwo/0.1" }
    },
    {
      fetchImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    }
  );

  const text = await response.text();
  if (!response.ok) throw seoulError("HTTP_ERROR", "HTTP", `서울시 API HTTP ${response.status}`, response.status >= 500);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw seoulError("PARSE_FAILED", "PARSE", "서울시 API JSON 파싱에 실패했습니다.", false);
  }

  return parseSeoulCatalogResponse(json, fetchedAt, apiKey);
}

function parseSeoulCatalogResponse(json, fetchedAt, apiKey = "") {
  const payload = json?.[API_SERVICE];
  if (!payload || typeof payload !== "object") {
    throw seoulError("PARSE_FAILED", "PARSE", "서울시 API 응답에 ListPublicReservationSport가 없습니다.", false);
  }

  const resultCode = payload.RESULT?.CODE || null;
  const resultMessage = payload.RESULT?.MESSAGE || "서울시 API 오류";
  if (resultCode && resultCode !== "INFO-000") {
    const safeMessage = sanitizeMessage(`${resultCode} ${resultMessage}`, apiKey);
    throw seoulError(isAuthError(resultCode, resultMessage) ? "AUTH_FAILED" : "API_ERROR", "API", `서울시 API 오류: ${safeMessage}`, isRetryableResult(resultCode));
  }

  const rows = payload.row;
  if (rows == null) {
    return buildCatalog([], payload.list_total_count, fetchedAt);
  }
  if (!Array.isArray(rows)) {
    throw seoulError("PARSE_FAILED", "PARSE", "서울시 API row가 배열이 아닙니다.", false);
  }

  return buildCatalog(rows.map(normalizeSeoulTennisService), payload.list_total_count, fetchedAt);
}

function buildCatalog(services, reportedTotalCount, fetchedAt) {
  const sortedServices = services.slice().sort((a, b) => (
    `${a.areaName} ${a.placeName} ${a.serviceName} ${a.serviceId}`.localeCompare(`${b.areaName} ${b.placeName} ${b.serviceName} ${b.serviceId}`, "ko")
  ));
  const places = groupSeoulTennisPlaces(sortedServices);
  return {
    totalServiceCount: sortedServices.length,
    reportedTotalCount: parseInteger(reportedTotalCount),
    uniquePlaceCount: places.length,
    fetchedAt,
    services: sortedServices,
    places
  };
}

async function fetchWithTimeout(url, init, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await options.fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw seoulError("TIMEOUT", "HTTP", `서울시 API 응답이 ${Math.round(options.timeoutMs / 1000)}초 안에 도착하지 않았습니다.`, true);
    }
    throw seoulError("NETWORK_ERROR", "HTTP", "서울시 API 네트워크 요청에 실패했습니다.", true);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSeoulApiUrl(apiKey, options = {}) {
  const startIndex = options.startIndex ?? 1;
  const endIndex = options.endIndex ?? DEFAULT_LIMIT;
  return `${API_HOST}/${encodeURIComponent(apiKey)}/${API_FORMAT}/${API_SERVICE}/${startIndex}/${endIndex}/${encodeURIComponent(TENNIS_QUERY)}`;
}

function catalogResponse(catalog, flags = {}) {
  return {
    totalServiceCount: catalog.totalServiceCount,
    reportedTotalCount: catalog.reportedTotalCount,
    uniquePlaceCount: catalog.uniquePlaceCount,
    fetchedAt: catalog.fetchedAt,
    cached: Boolean(flags.cached),
    stale: Boolean(flags.stale),
    ...(flags.warning ? { warning: flags.warning } : {}),
    services: catalog.services,
    places: catalog.places
  };
}

function isFreshCache(value, now) {
  return Boolean(value?.fetchedAt && now.getTime() - Date.parse(value.fetchedAt) < CACHE_TTL_MS);
}

function normalizeRawValue(value) {
  if (value == null || value === "") return null;
  return String(value).trim();
}

function parseCoordinate(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function isAuthError(code, message) {
  return /ERROR-30|인증|인증키|key/i.test(`${code} ${message}`);
}

function isRetryableResult(code) {
  return /^ERROR-5|^ERROR-6|^ERROR-9/.test(String(code || ""));
}

function sanitizeMessage(message, apiKey) {
  const safe = String(message || "");
  return apiKey ? safe.split(apiKey).join("[redacted]") : safe;
}

function seoulError(type, stage, message, retryable) {
  return diagnosticError({
    provider: "seoul",
    type,
    stage,
    retryable,
    message
  });
}
