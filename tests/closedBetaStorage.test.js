import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;

async function loadStorage() {
  vi.resetModules();
  process.env.DATA_DIR = tempDir;
  return import("../src/storage.js");
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "tennis-beta-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  vi.resetModules();
});

describe("closed beta storage", () => {
  it("claims a valid invite once and creates a user session", async () => {
    const { addInviteCode, claimInviteCode, getUserBySessionToken, loadState } = await loadStorage();
    await addInviteCode({ code: "TENNIS-AAAA-BBBB" });

    const { user, token } = await claimInviteCode({ code: "tennis-aaaa-bbbb", name: "A" });
    const authed = await getUserBySessionToken(token);
    const state = await loadState();

    expect(authed.id).toBe(user.id);
    expect(state.inviteCodes[0]).toMatchObject({ used: true, usedBy: user.id });
    await expect(claimInviteCode({ code: "TENNIS-AAAA-BBBB" })).rejects.toThrow("이미 사용");
  });

  it("rejects invalid and disabled invite codes", async () => {
    const { addInviteCode, claimInviteCode } = await loadStorage();
    await addInviteCode({ code: "TENNIS-DISABLED", enabled: false });

    await expect(claimInviteCode({ code: "NOPE" })).rejects.toThrow("유효하지 않은");
    await expect(claimInviteCode({ code: "TENNIS-DISABLED" })).rejects.toThrow("비활성화");
  });

  it("connects Telegram chat ids through one-use link tokens", async () => {
    const { addInviteCode, claimInviteCode, connectTelegramLinkToken, createTelegramLinkToken } = await loadStorage();
    await addInviteCode({ code: "TENNIS-LINK-0001" });
    const { user } = await claimInviteCode({ code: "TENNIS-LINK-0001" });
    const token = await createTelegramLinkToken(user.id);

    const connected = await connectTelegramLinkToken(token, "chat-a");
    const reused = await connectTelegramLinkToken(token, "chat-b");

    expect(connected.telegramChatId).toBe("chat-a");
    expect(connected.telegramConnected).toBe(true);
    expect(reused).toBeNull();
  });

  it("enforces watch ownership on update and delete", async () => {
    const { addWatch, deleteWatch, updateWatch } = await loadStorage();
    const watch = await addWatch({
      userId: "u1",
      venues: ["gangil"],
      date: "2026-08-29",
      times: ["18:00~20:00"],
      provider: "gangdong"
    });

    await expect(updateWatch(watch.id, { enabled: false }, "u2")).rejects.toThrow("다른 사용자");
    await expect(deleteWatch(watch.id, "u2")).rejects.toThrow("다른 사용자");
    await expect(updateWatch(watch.id, { enabled: false }, "u1")).resolves.toMatchObject({ enabled: false });
  });
});
