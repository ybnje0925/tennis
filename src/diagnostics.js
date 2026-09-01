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
  if (error instanceof CheckDiagnosticError) {
    return {
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
  }

  const message = String(error?.message || error || "Unknown error");
  const type = inferErrorType(error, message);
  return {
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

function inferErrorType(error, message) {
  if (error?.code === "PROVIDER_TIMEOUT" || error?.name === "ProviderTimeoutError") return "TIMEOUT";
  if (/timeout|Timeout/i.test(message)) return "TIMEOUT";
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
