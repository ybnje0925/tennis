import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

const DATA_DIR = path.resolve(config.dataDir);
const STATE_FILE = path.join(DATA_DIR, "state.json");

const initialState = {
  watches: [],
  lastAvailability: {},
  sentNotifications: {},
  system: {
    lastCheckedAt: null,
    nextCheckAt: null,
    lastManualCheckAt: null,
    venues: {},
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

export async function deleteWatch(id) {
  const state = await loadState();
  state.watches = state.watches.filter((watch) => watch.id !== id);
  for (const key of Object.keys(state.sentNotifications)) {
    if (key.startsWith(`${id}|`)) delete state.sentNotifications[key];
  }
  await saveState(state);
}

export async function updateWatch(id, patch) {
  const state = await loadState();
  const watch = state.watches.find((item) => item.id === id);
  if (!watch) throw new Error("알림 조건을 찾을 수 없습니다.");
  if (typeof patch.enabled === "boolean") watch.enabled = patch.enabled;
  await saveState(state);
  return watch;
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
    ? state.watches.map((watch) => ({ enabled: true, ...watch }))
    : [];
  state.lastAvailability = state.lastAvailability || {};
  state.sentNotifications = state.sentNotifications || {};
  state.system.venues = state.system.venues || {};
  state.system.logs = Array.isArray(state.system.logs) ? state.system.logs.slice(-80) : [];
  return state;
}
