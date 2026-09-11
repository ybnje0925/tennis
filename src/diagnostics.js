import { VENUES } from "./constants.js";

export class CheckDiagnosticError extends Error {
  constructor({
    type = "UNKNOWN_ERROR",
    stage = "UNKNOWN",
    message = "",
    provider = null,
    venueId = null,
    targetDate = null,
    retryable = false,
    details = {},
    cause = null
  } = {}) {
    super(message || type, { cause });
    this.name = "CheckDiagnosticError";
    this.type = type;
    this.code = type;
    this.stage = stage;
    this.provider = provider;
    this.venueId = venueId;
    this.venueName = venueId ? VENUES[venueId]?.name : null;
    this.targetDate = targetDate;
    this.retryable = retryable;
    this.details = details;
  }
}

export function diagnosticError(input) {
  if (input instanceof CheckDiagnosticError) return input;
  return new CheckDiagnosticError(input);
}

export function classifyError(error, fallback = {}) {
  let diagnostic;
  if (error instanceof CheckDiagnosticError) {
    diagnostic = {
      provider: fallback.provider ?? error.provider,
      venueId: fallback.venueId ?? error.venueId,
      venueName: fallback.venueName ?? error.venueName,
      targetDate: fallback.targetDate ?? error.targetDate,
      stage: fallback.stage ?? error.stage,
      type: error.type,
      message: error.message,
      retryable: Boolean(error.retryable),
      details: error.details || {},
      stack: error.stack
    };
    return withUserMessage(diagnostic);
  }

  const message = String(error?.message || error || "Unknown error");
  const type = inferErrorType(error, message);
  diagnostic = {
    provider: fallback.provider ?? null,
    venueId: fallback.venueId ?? null,
    venueName: fallback.venueName ?? (fallback.venueId ? VENUES[fallback.venueId]?.name : null),
    targetDate: fallback.targetDate ?? null,
    stage: fallback.stage ?? inferStage(message),
    type,
    message,
    retryable: isRetryableType(type),
    details: {},
    stack: error?.stack
  };
  return withUserMessage(diagnostic);
}

export function errorMessageForConsole(diagnostic) {
  const parts = [
    `provider=${diagnostic.provider || "-"}`,
    `venue=${diagnostic.venueName || diagnostic.venueId || "-"}`,
    `date=${diagnostic.targetDate || "-"}`,
    `stage=${diagnostic.stage || "-"}`,
    `type=${diagnostic.type || "UNKNOWN_ERROR"}`,
    `message=${diagnostic.message || ""}`
  ];
  return parts.join(" | ");
}

export function isRetryableDiagnostic(error) {
  const diagnostic = classifyError(error);
  return Boolean(diagnostic.retryable);
}

export function userErrorGuide(type, message = "") {
  const text = String(message || "");
  if (type === "BROWSER_LAUNCH_FAILED") {
    const detail = /EAGAIN|resource|temporar/i.test(text)
      ? "서버 자원이 잠시 부족해서 예약 사이트를 확인할 브라우저를 새로 열지 못했습니다."
      : /SIGTRAP|Target page, context or browser has been closed|browser has been closed/i.test(text)
        ? "예약 사이트를 확인하려고 브라우저를 켰지만, 시작 직후 브라우저가 종료됐습니다."
        : "예약 사이트를 확인할 브라우저를 시작하지 못했습니다.";
    return {
      category: "브라우저 시작 문제",
      summary: detail,
      action: "대부분 일시적인 문제라 다음 조회 때 다시 시도됩니다. 반복되면 서버 재시작이나 메모리/프로세스 사용량 확인이 필요합니다."
    };
  }
  if (type === "TIMEOUT") {
    return {
      category: "응답 지연",
      summary: "예약 사이트가 제한 시간 안에 응답하지 않았습니다.",
      action: "잠시 후 자동으로 다시 조회됩니다. 같은 시설에서 반복되면 해당 사이트가 느리거나 점검 중일 수 있습니다."
    };
  }
  if (type === "NETWORK_DNS") {
    return {
      category: "주소 연결 문제",
      summary: "예약 사이트 주소를 찾지 못했습니다.",
      action: "사이트 주소가 바뀌었거나 일시적인 DNS 문제일 수 있습니다. 반복되면 예약 페이지 주소를 확인해야 합니다."
    };
  }
  if (type === "NETWORK_TLS") {
    return {
      category: "보안 연결 문제",
      summary: "예약 사이트와 보안 연결을 맺지 못했습니다.",
      action: "사이트 인증서나 서버 설정 문제일 수 있습니다. 시간이 지나도 계속되면 해당 사이트 접속 상태를 확인해야 합니다."
    };
  }
  if (type === "NETWORK_ERROR") {
    return {
      category: "네트워크 문제",
      summary: "예약 사이트에 연결하는 중 네트워크 오류가 났습니다.",
      action: "대부분 일시적인 연결 문제라 다음 조회 때 다시 시도됩니다."
    };
  }
  if (type === "LOGIN_OR_PROTECTION_PAGE") {
    return {
      category: "로그인/접근 보호 문제",
      summary: "예약현황 대신 로그인 화면이나 접근 보호 화면이 나타났습니다.",
      action: "계정 로그인 상태, 중복 로그인, 사이트 차단 안내가 있는지 확인이 필요합니다."
    };
  }
  if (type === "CALENDAR_DATE_NOT_FOUND") {
    return {
      category: "날짜 선택 문제",
      summary: "예약 달력에서 요청한 날짜를 찾지 못했습니다.",
      action: "예약 가능 기간이 아직 열리지 않았거나 사이트 화면 구성이 바뀌었을 수 있습니다."
    };
  }
  if (type === "PARSE_FAILED") {
    return {
      category: "화면 읽기 문제",
      summary: "예약 사이트 화면은 열렸지만 빈자리 정보를 읽어내지 못했습니다.",
      action: "사이트 화면 구성이 바뀌었을 가능성이 있습니다. 반복되면 파서 수정이 필요합니다."
    };
  }
  return {
    category: "알 수 없는 조회 문제",
    summary: "예약현황 조회 중 예상하지 못한 문제가 발생했습니다.",
    action: "다음 조회 때 다시 시도됩니다. 반복되면 기술 로그를 확인해 원인을 좁혀야 합니다."
  };
}

function withUserMessage(diagnostic) {
  const guide = userErrorGuide(diagnostic.type, diagnostic.message);
  return {
    ...diagnostic,
    userCategory: guide.category,
    userMessage: guide.summary,
    userAction: guide.action
  };
}

function inferErrorType(error, message) {
  if (error?.code === "PROVIDER_TIMEOUT" || error?.name === "ProviderTimeoutError") return "TIMEOUT";
  if (/timeout|Timeout/i.test(message)) return "TIMEOUT";
  if (/EAGAIN|Failed to launch|spawn .*chrome|browserType\.launch|Chromium/i.test(message)) return "BROWSER_LAUNCH_FAILED";
  if (/net::ERR_NAME_NOT_RESOLVED|ENOTFOUND|DNS/i.test(message)) return "NETWORK_DNS";
  if (/net::ERR_CERT|TLS|certificate/i.test(message)) return "NETWORK_TLS";
  if (/net::ERR|ECONNRESET|ECONNREFUSED|fetch failed|network/i.test(message)) return "NETWORK_ERROR";
  if (/CALENDAR_DATE_NOT_FOUND/.test(message)) return "CALENDAR_DATE_NOT_FOUND";
  if (/login|로그인|보호|차단|WebGate|비정상/i.test(message)) return "LOGIN_OR_PROTECTION_PAGE";
  if (/달력 연월|year-month|날짜 이동|selector|DOM|parse|파싱/i.test(message)) return "PARSE_FAILED";
  return "UNKNOWN_ERROR";
}

function inferStage(message) {
  if (/브라우저|browser|Chromium/i.test(message)) return "BROWSER";
  if (/login|로그인|보호|차단|WebGate|비정상/i.test(message)) return "AUTH_OR_PROTECTION";
  if (/CALENDAR|달력|날짜/i.test(message)) return "CALENDAR";
  if (/DOM|parse|파싱/i.test(message)) return "PARSE";
  if (/network|DNS|TLS|goto|navigation|페이지 접근/i.test(message)) return "NAVIGATION";
  return "UNKNOWN";
}

function isRetryableType(type) {
  return ["TIMEOUT", "NETWORK_ERROR", "NETWORK_DNS", "NETWORK_TLS", "BROWSER_LAUNCH_FAILED", "BROWSER_CONTEXT_FAILED"].includes(type);
}
