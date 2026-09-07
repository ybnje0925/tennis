import { chromium } from "playwright";
import { withTimeout } from "./providerTiming.js";

const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAYS_MS = [1000, 3000];

let launchQueue = Promise.resolve();

export async function launchPersistentContext(userDataDir, launchOptions, options = {}) {
  const providerLabel = options.providerLabel || "브라우저";
  const stepLabel = options.stepLabel || "브라우저 실행";
  const timeoutMs = options.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  return enqueueLaunch(() => launchPersistentContextWithRetry(
    userDataDir,
    launchOptions,
    { providerLabel, stepLabel, timeoutMs, retryDelaysMs }
  ));
}

export function isBrowserLaunchRetryable(error) {
  const message = String(error?.message || error || "");
  return /EAGAIN|EBUSY|ETIMEDOUT|Failed to launch|spawn .*chrome|browserType\.launch/i.test(message);
}

async function enqueueLaunch(fn) {
  const previous = launchQueue;
  let release;
  launchQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

async function launchPersistentContextWithRetry(userDataDir, launchOptions, options) {
  const delays = [0, ...options.retryDelaysMs];
  let lastError;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await wait(delays[attempt]);
    try {
      return await withTimeout(
        chromium.launchPersistentContext(userDataDir, launchOptions),
        options.timeoutMs,
        options.providerLabel,
        options.stepLabel
      );
    } catch (error) {
      lastError = error;
      if (!isBrowserLaunchRetryable(error) || attempt === delays.length - 1) throw error;
      console.warn(`${options.providerLabel} ${options.stepLabel} 재시도 ${attempt + 1}/${delays.length - 1} | ${error.message}`);
    }
  }

  throw lastError;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
