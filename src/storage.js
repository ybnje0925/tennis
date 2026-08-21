import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const initialState = {
  watches: [],
  lastAvailability: {},
  sentNotifications: {}
};

export async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return { ...structuredClone(initialState), ...JSON.parse(raw) };
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
    venues: input.venues,
    date: input.date,
    times: input.times,
    createdAt: new Date().toISOString()
  };
  state.watches.push(watch);
  await saveState(state);
  return watch;
}

export async function deleteWatch(id) {
  const state = await loadState();
  state.watches = state.watches.filter((watch) => watch.id !== id);
  await saveState(state);
}
