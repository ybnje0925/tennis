import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

const DATA_DIR = path.resolve(config.dataDir);
const STATE_FILE = path.join(DATA_DIR, "state.json");

const initialState = {
  users: [],
  inviteCodes: [],
  sessions: [],
  telegramLinkTokens: [],
  deviceLinkCodes: [],
  deviceLinkFailures: [],
  watches: [],
  lastAvailability: {},
  sentNotifications: {},
  system: {
    lastCheckedAt: null,
    nextCheckAt: null,
    lastManualCheckAt: null,
    venues: {},
    providers: {},
    logs: []
  }
};

export async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(initialState);
    throw error;
  }
}

export async function saveState(state) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export async function addWatch(input) {
  const state = await loadState();
  const watch = {
    id: crypto.randomUUID(),
    userId: input.userId,
    provider: input.provider,
    venues: input.venues,
    venue: input.venue,
    date: input.date,
    times: input.times,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  state.watches.push(watch);
  await saveState(state);
  return watch;
}

export async function deleteWatch(id, userId = null) {
  const state = await loadState();
  const watch = state.watches.find((item) => item.id === id);
  if (!watch) throw new Error("알림 조건을 찾을 수 없습니다.");
  if (userId && watch.userId !== userId) throw new Error("다른 사용자의 알림 조건은 변경할 수 없습니다.");
  state.watches = state.watches.filter((item) => item.id !== id);
  for (const key of Object.keys(state.sentNotifications)) {
    if (key.startsWith(`${id}|`)) delete state.sentNotifications[key];
  }
  await saveState(state);
}

export async function updateWatch(id, patch, userId = null) {
  const state = await loadState();
  const watch = state.watches.find((item) => item.id === id);
  if (!watch) throw new Error("알림 조건을 찾을 수 없습니다.");
  if (userId && watch.userId !== userId) throw new Error("다른 사용자의 알림 조건은 변경할 수 없습니다.");
  if (typeof patch.enabled === "boolean") watch.enabled = patch.enabled;
  await saveState(state);
  return watch;
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createRandomToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function createSessionForUser(state, userId) {
  const now = new Date().toISOString();
  const token = createRandomToken();
  const session = {
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()
  };
  state.sessions.push(session);
  return { token, session };
}

export function createInviteCode() {
  const left = crypto.randomBytes(2).toString("hex").toUpperCase();
  const mid = crypto.randomBytes(2).toString("hex").toUpperCase();
  const right = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `TENNIS-${left}-${mid}-${right}`;
}

export async function addInviteCode(input = {}) {
  const state = await loadState();
  const invite = {
    code: input.code || createInviteCode(),
    used: false,
    usedBy: null,
    createdAt: new Date().toISOString(),
    usedAt: null,
    enabled: input.enabled !== false
  };
  state.inviteCodes.push(invite);
  await saveState(state);
  return invite;
}

export async function claimInviteCode({ code, name }) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const state = await loadState();
  const invite = state.inviteCodes.find((item) => item.code === normalizedCode);
  if (!invite) throw new Error("유효하지 않은 초대코드입니다.");
  if (invite.enabled === false) throw new Error("비활성화된 초대코드입니다.");
  if (invite.used) throw new Error("이미 사용된 초대코드입니다.");

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    name: String(name || "").trim() || null,
    telegramChatId: null,
    telegramConnected: false,
    enabled: true,
    createdAt: now
  };
  const { token } = createSessionForUser(state, user.id);

  invite.used = true;
  invite.usedBy = user.id;
  invite.usedAt = now;
  state.users.push(user);
  await saveState(state);
  return { user, token };
}

function normalizeDeviceLinkCode(code) {
  return String(code || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

function formatDeviceLinkCode(value) {
  return `${value.slice(0, 3)}-${value.slice(3)}`;
}

function createHumanDeviceCode() {
  return formatDeviceLinkCode(String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"));
}

function assertDeviceLinkRateLimit(state, rateLimitKey) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  state.deviceLinkFailures = (state.deviceLinkFailures || []).filter((item) => Date.parse(item.at) > now - windowMs);
  const attempts = state.deviceLinkFailures.filter((item) => item.rateLimitKey === rateLimitKey);
  if (attempts.length >= 5) {
    throw new Error("연결 코드 입력 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.");
  }
}

function recordDeviceLinkFailure(state, rateLimitKey) {
  state.deviceLinkFailures ||= [];
  state.deviceLinkFailures.push({ rateLimitKey, at: new Date().toISOString() });
}

export async function createDeviceLinkCode(userId, options = {}) {
  const state = await loadState();
  const user = state.users.find((item) => item.id === userId);
  if (!user || user.enabled === false) throw new Error("사용자를 찾을 수 없습니다.");

  let code = createHumanDeviceCode();
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const codeHash = hashToken(normalizeDeviceLinkCode(code));
    if (!state.deviceLinkCodes.some((item) => !item.usedAt && item.codeHash === codeHash)) break;
    code = createHumanDeviceCode();
  }

  const now = new Date();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 10 * 60 * 1000;
  const link = {
    codeHash: hashToken(normalizeDeviceLinkCode(code)),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    usedAt: null
  };
  state.deviceLinkCodes.push(link);
  await saveState(state);
  return { code, expiresAt: link.expiresAt };
}

export async function claimDeviceLinkCode({ code, rateLimitKey = "global" }) {
  const normalizedCode = normalizeDeviceLinkCode(code);
  const state = await loadState();
  assertDeviceLinkRateLimit(state, rateLimitKey);

  const link = state.deviceLinkCodes.find((item) => item.codeHash === hashToken(normalizedCode));
  const expired = !link || Date.parse(link.expiresAt) <= Date.now();
  if (expired || link.usedAt) {
    recordDeviceLinkFailure(state, rateLimitKey);
    await saveState(state);
    throw new Error("유효하지 않거나 만료된 연결 코드입니다.");
  }

  const user = state.users.find((item) => item.id === link.userId);
  if (!user || user.enabled === false) {
    recordDeviceLinkFailure(state, rateLimitKey);
    await saveState(state);
    throw new Error("유효하지 않거나 만료된 연결 코드입니다.");
  }

  link.usedAt = new Date().toISOString();
  state.deviceLinkFailures = (state.deviceLinkFailures || []).filter((item) => item.rateLimitKey !== rateLimitKey);
  const { token } = createSessionForUser(state, user.id);
  await saveState(state);
  return { user, token };
}

export async function getUserBySessionToken(token) {
  if (!token) return null;
  const state = await loadState();
  const tokenHash = hashToken(token);
  const session = state.sessions.find((item) => item.tokenHash === tokenHash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const user = state.users.find((item) => item.id === session.userId);
  if (!user || user.enabled === false) return null;
  session.lastSeenAt = new Date().toISOString();
  await saveState(state);
  return user;
}

export async function createTelegramLinkToken(userId) {
  const state = await loadState();
  const user = state.users.find((item) => item.id === userId);
  if (!user || user.enabled === false) throw new Error("사용자를 찾을 수 없습니다.");
  const token = createRandomToken(24);
  const now = new Date();
  state.telegramLinkTokens.push({
    tokenHash: hashToken(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    used: false,
    usedAt: null
  });
  await saveState(state);
  return token;
}

export async function connectTelegramLinkToken(token, chatId) {
  const state = await loadState();
  const tokenHash = hashToken(String(token || ""));
  const link = state.telegramLinkTokens.find((item) => item.tokenHash === tokenHash);
  if (!link || link.used || Date.parse(link.expiresAt) <= Date.now()) return null;
  const user = state.users.find((item) => item.id === link.userId);
  if (!user || user.enabled === false) return null;

  user.telegramChatId = String(chatId);
  user.telegramConnected = true;
  link.used = true;
  link.usedAt = new Date().toISOString();
  await saveState(state);
  return user;
}

export async function setUserEnabled(userId, enabled) {
  const state = await loadState();
  const user = state.users.find((item) => item.id === userId);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");
  user.enabled = enabled;
  if (!enabled) {
    for (const watch of state.watches.filter((item) => item.userId === userId)) {
      watch.enabled = false;
    }
  }
  await saveState(state);
  return user;
}

function normalizeState(raw) {
  const state = {
    ...structuredClone(initialState),
    ...raw,
    system: {
      ...structuredClone(initialState.system),
      ...(raw.system || {})
    }
  };

  state.watches = Array.isArray(state.watches)
    ? state.watches.map((watch) => ({ enabled: true, ...watch, userId: watch.userId || config.legacyOwnerUserId || null }))
    : [];
  state.users = Array.isArray(state.users) ? state.users : [];
  state.inviteCodes = Array.isArray(state.inviteCodes) ? state.inviteCodes : [];
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.telegramLinkTokens = Array.isArray(state.telegramLinkTokens) ? state.telegramLinkTokens : [];
  state.deviceLinkCodes = Array.isArray(state.deviceLinkCodes) ? state.deviceLinkCodes : [];
  state.deviceLinkFailures = Array.isArray(state.deviceLinkFailures) ? state.deviceLinkFailures : [];
  state.lastAvailability = state.lastAvailability || {};
  state.sentNotifications = state.sentNotifications || {};
  state.system.venues = state.system.venues || {};
  state.system.providers = state.system.providers || {};
  state.system.logs = Array.isArray(state.system.logs) ? state.system.logs.slice(-30) : [];
  return state;
}
