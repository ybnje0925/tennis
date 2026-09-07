import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchSeoulTennisServices,
  filterSeoulTennisCatalog,
  resetSeoulPublicCache
} from "../src/providers/seoulPublicProvider.js";

const API_KEY = "SECRET_SEOUL_KEY";

beforeEach(() => {
  resetSeoulPublicCache();
});

describe("fetchSeoulTennisServices", () => {
  it("normalizes INFO-000 responses", async () => {
    const fetchImpl = mockJsonFetch(successPayload([row({ SVCID: "S1", SVCNM: "잠실 테니스", PLACENM: "잠실테니스장", AREANM: "송파구" })]));

    const result = await fetchSeoulTennisServices({ apiKey: API_KEY, fetchImpl, now: fixedNow });

    expect(result).toMatchObject({
      totalServiceCount: 1,
      reportedTotalCount: 1,
      uniquePlaceCount: 1,
      fetchedAt: "2026-09-08T00:00:00.000Z",
      cached: false,
      stale: false
    });
    expect(result.services[0]).toMatchObject({
      serviceId: "S1",
      serviceName: "잠실 테니스",
      placeName: "잠실테니스장",
      areaName: "송파구",
      status: "접수중",
      paymentType: "유료",
      categoryMajor: "체육시설",
      categoryMinor: "테니스장",
      targetInfo: "누구나",
      reservationUrl: "https://yeyak.seoul.go.kr/web/reservation/selectReservView.do?rsv_svc_id=S1",
      latitude: 37.5,
      longitude: 127.1,
      minPeople: 1,
      maxPeople: 4,
      reservationStandardDay: "이용예정 7일 전"
    });
    expect(result.services[0].raw).toMatchObject({
      SVCID: "S1",
      SVCNM: "잠실 테니스",
      PLACENM: "잠실테니스장"
    });
  });

  it("groups multiple service ids under the same area and place", async () => {
    const fetchImpl = mockJsonFetch(successPayload([
      row({ SVCID: "S1", PLACENM: "잠실테니스장", AREANM: "송파구" }),
      row({ SVCID: "S2", PLACENM: "잠실테니스장", AREANM: "송파구" })
    ]));

    const result = await fetchSeoulTennisServices({ apiKey: API_KEY, fetchImpl, now: fixedNow });

    expect(result.totalServiceCount).toBe(2);
    expect(result.uniquePlaceCount).toBe(1);
    expect(result.places[0]).toMatchObject({
      placeKey: "송파구|잠실테니스장",
      serviceCount: 2
    });
  });

  it("does not merge places with the same name in different areas", async () => {
    const fetchImpl = mockJsonFetch(successPayload([
      row({ SVCID: "S1", PLACENM: "테니스장", AREANM: "송파구" }),
      row({ SVCID: "S2", PLACENM: "테니스장", AREANM: "강남구" })
    ]));

    const result = await fetchSeoulTennisServices({ apiKey: API_KEY, fetchImpl, now: fixedNow });

    expect(result.uniquePlaceCount).toBe(2);
    expect(result.places.map((place) => place.placeKey).sort()).toEqual(["강남구|테니스장", "송파구|테니스장"]);
  });

  it("handles empty rows", async () => {
    const result = await fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl: mockJsonFetch(successPayload([])),
      now: fixedNow
    });

    expect(result.services).toEqual([]);
    expect(result.places).toEqual([]);
  });

  it("throws a diagnostic for non INFO-000 result codes", async () => {
    await expect(fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl: mockJsonFetch({
        ListPublicReservationSport: {
          RESULT: { CODE: "ERROR-300", MESSAGE: "인증키 오류" }
        }
      }),
      now: fixedNow
    })).rejects.toMatchObject({
      provider: "seoul",
      type: "AUTH_FAILED",
      stage: "API"
    });
  });

  it("fails safely when the API key is missing", async () => {
    await expect(fetchSeoulTennisServices({ apiKey: "", fetchImpl: vi.fn(), now: fixedNow })).rejects.toMatchObject({
      provider: "seoul",
      type: "CONFIG_MISSING"
    });
  });

  it("converts fetch network errors to retryable diagnostics", async () => {
    await expect(fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl: vi.fn(async () => {
        throw new Error(`fetch failed ${API_KEY}`);
      }),
      now: fixedNow
    })).rejects.toMatchObject({
      type: "NETWORK_ERROR",
      retryable: true
    });
  });

  it("times out stalled API calls", async () => {
    const fetchImpl = vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    }));

    await expect(fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl,
      now: fixedNow,
      timeoutMs: 1
    })).rejects.toMatchObject({
      type: "TIMEOUT",
      retryable: true
    });
  });

  it("rejects malformed JSON and abnormal response shapes", async () => {
    await expect(fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl: vi.fn(async () => response("not-json")),
      now: fixedNow
    })).rejects.toMatchObject({ type: "PARSE_FAILED" });

    await expect(fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl: mockJsonFetch({ wrong: {} }),
      now: fixedNow
    })).rejects.toMatchObject({ type: "PARSE_FAILED" });

    await expect(fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl: mockJsonFetch({ ListPublicReservationSport: { RESULT: { CODE: "INFO-000" }, row: {} } }),
      now: fixedNow
    })).rejects.toMatchObject({ type: "PARSE_FAILED" });
  });

  it("uses a fresh in-memory cache within the ttl", async () => {
    const fetchImpl = mockJsonFetch(successPayload([row({ SVCID: "S1" })]));

    const first = await fetchSeoulTennisServices({ apiKey: API_KEY, fetchImpl, now: fixedNow });
    const second = await fetchSeoulTennisServices({ apiKey: API_KEY, fetchImpl, now: () => new Date("2026-09-08T00:09:00.000Z") });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.stale).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes cache after expiration", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(successPayload([row({ SVCID: "S1" })])))
      .mockResolvedValueOnce(jsonResponse(successPayload([row({ SVCID: "S2" })])));

    await fetchSeoulTennisServices({ apiKey: API_KEY, fetchImpl, now: fixedNow });
    const second = await fetchSeoulTennisServices({ apiKey: API_KEY, fetchImpl, now: () => new Date("2026-09-08T00:11:00.000Z") });

    expect(second.cached).toBe(false);
    expect(second.services[0].serviceId).toBe("S2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns stale cache when refresh fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(successPayload([row({ SVCID: "S1" })])))
      .mockRejectedValueOnce(new Error("network down"));

    await fetchSeoulTennisServices({ apiKey: API_KEY, fetchImpl, now: fixedNow });
    const stale = await fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl,
      now: () => new Date("2026-09-08T00:11:00.000Z")
    });

    expect(stale).toMatchObject({
      cached: true,
      stale: true,
      totalServiceCount: 1
    });
  });

  it("does not expose the API key in errors or results", async () => {
    await expect(fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl: mockJsonFetch({
        ListPublicReservationSport: {
          RESULT: { CODE: "ERROR-300", MESSAGE: `bad key ${API_KEY}` }
        }
      }),
      now: fixedNow
    })).rejects.not.toThrow(API_KEY);

    const result = await fetchSeoulTennisServices({
      apiKey: API_KEY,
      fetchImpl: mockJsonFetch(successPayload([row({ SVCID: "S1" })])),
      now: fixedNow
    });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});

describe("filterSeoulTennisCatalog", () => {
  it("filters by area, status, place name, and service name", () => {
    const catalog = {
      totalServiceCount: 3,
      uniquePlaceCount: 2,
      fetchedAt: "2026-09-08T00:00:00.000Z",
      cached: false,
      stale: false,
      services: [
        service({ serviceId: "S1", serviceName: "잠실 야간", placeName: "잠실테니스장", areaName: "송파구", status: "접수중" }),
        service({ serviceId: "S2", serviceName: "목동 주간", placeName: "목동테니스장", areaName: "양천구", status: "접수중" }),
        service({ serviceId: "S3", serviceName: "잠원 주간", placeName: "잠원테니스장", areaName: "서초구", status: "접수종료" })
      ],
      places: []
    };

    const result = filterSeoulTennisCatalog(catalog, { area: "송파구", status: "접수중", q: "야간" });

    expect(result.totalServiceCount).toBe(1);
    expect(result.uniquePlaceCount).toBe(1);
    expect(result.services[0].serviceId).toBe("S1");
  });
});

function fixedNow() {
  return new Date("2026-09-08T00:00:00.000Z");
}

function row(overrides = {}) {
  return {
    SVCID: "S1",
    SVCNM: "서울 테니스장",
    MAXCLASSNM: "체육시설",
    MINCLASSNM: "테니스장",
    SVCSTATNM: "접수중",
    PAYATNM: "유료",
    PLACENM: "서울테니스장",
    USETGTINFO: "누구나",
    SVCURL: `https://yeyak.seoul.go.kr/web/reservation/selectReservView.do?rsv_svc_id=${overrides.SVCID || "S1"}`,
    X: "127.1",
    Y: "37.5",
    SVCOPNBGNDT: "2026-09-01 06:00:00",
    SVCOPNENDDT: "2026-09-30 22:00:00",
    RCPTBGNDT: "2026-08-25 09:00:00",
    RCPTENDDT: "2026-09-29 18:00:00",
    AREANM: "송파구",
    TELNO: "02-000-0000",
    V_MIN: "1",
    V_MAX: "4",
    REVSTDDAY: "이용예정 7일 전",
    ...overrides
  };
}

function service(overrides = {}) {
  return {
    serviceId: "S1",
    serviceName: "서울 테니스장",
    placeName: "서울테니스장",
    areaName: "송파구",
    status: "접수중",
    ...overrides
  };
}

function successPayload(rows) {
  return {
    ListPublicReservationSport: {
      list_total_count: rows.length,
      RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다" },
      row: rows
    }
  };
}

function mockJsonFetch(body) {
  return vi.fn(async () => jsonResponse(body));
}

function jsonResponse(body) {
  return response(JSON.stringify(body));
}

function response(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: async () => body
  };
}
