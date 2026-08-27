export const PROVIDER_WARNING_MS = 60_000;

export class ProviderTimeoutError extends Error {
  constructor(providerLabel, stepLabel, timeoutMs) {
    super(`${providerLabel} ${stepLabel} timeout after ${(timeoutMs / 1000).toFixed(1)}초`);
    this.name = "ProviderTimeoutError";
    this.providerLabel = providerLabel;
    this.stepLabel = stepLabel;
    this.timeoutMs = timeoutMs;
  }
}

export function createProviderTimer(providerLabel, options = {}) {
  const now = options.now || (() => new Date());
  const log = options.log || console.info;
  const warn = options.warn || console.warn;
  const startedAt = now();
  let lastStepAt = startedAt;

  log(`${providerLabel} 조회 START`);

  function elapsedMs(since = startedAt) {
    return now().getTime() - since.getTime();
  }

  async function step(label, fn) {
    const stepStartedAt = now();
    lastStepAt = stepStartedAt;
    log(`${providerLabel} ${label} 시작`);
    try {
      const result = await fn();
      log(`${providerLabel} ${label} 완료 ${formatSeconds(elapsedMs(stepStartedAt))}`);
      return result;
    } catch (error) {
      warn(`${providerLabel} ${label} 실패 ${formatSeconds(elapsedMs(stepStartedAt))} | ${error.message}`);
      throw error;
    }
  }

  function end(error = null) {
    const totalMs = elapsedMs(startedAt);
    const message = `${providerLabel} 조회 END 총 ${formatSeconds(totalMs)}`;
    if (totalMs > PROVIDER_WARNING_MS) {
      warn(`${providerLabel} 조회 WARNING - 1분 초과 (${formatSeconds(totalMs)})`);
    }
    if (error) warn(`${message} | 오류 ${error.message}`);
    else log(message);
    return totalMs;
  }

  function timeoutLocation() {
    return `${providerLabel} ${formatSeconds(elapsedMs(lastStepAt))}`;
  }

  return { step, end, timeoutLocation };
}

export async function withTimeout(promise, timeoutMs, providerLabel, stepLabel) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new ProviderTimeoutError(providerLabel, stepLabel, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}초`;
}
