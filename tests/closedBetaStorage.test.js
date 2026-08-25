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

  it("adds a second session to the existing user through a device link code", async () => {
    const {
      addInviteCode,
      claimDeviceLinkCode,
      claimInviteCode,
      createDeviceLinkCode,
      getUserBySessionToken,
      loadState
    } = await loadStorage();
    await addInviteCode({ code: "TENNIS-DEVICE-0001" });
    const pc = await claimInviteCode({ code: "TENNIS-DEVICE-0001", name: "A" });
    const link = await createDeviceLinkCode(pc.user.id);
    const mobile = await claimDeviceLinkCode({ code: link.code, rateLimitKey: "mobile" });
    const state = await loadState();

    expect((await getUserBySessionToken(pc.token)).id).toBe(pc.user.id);
    expect((await getUserBySessionToken(mobile.token)).id).toBe(pc.user.id);
    expect(state.sessions.filter((session) => session.userId === pc.user.id)).toHaveLength(2);
    expect(state.deviceLinkCodes[0].codeHash).toBeDefined();
    expect(JSON.stringify(state.deviceLinkCodes)).not.toContain(link.code);
  });

  it("keeps watches as one server-side list shared by sessions for the same user", async () => {
    const {
      addInviteCode,
      addWatch,
      claimDeviceLinkCode,
      claimInviteCode,
      createDeviceLinkCode,
      deleteWatch,
      loadState
    } = await loadStorage();
    await addInviteCode({ code: "TENNIS-SYNC-0001" });
    const pc = await claimInviteCode({ code: "TENNIS-SYNC-0001" });
    await claimDeviceLinkCode({ code: (await createDeviceLinkCode(pc.user.id)).code, rateLimitKey: "mobile" });
    const watch = await addWatch({
      userId: pc.user.id,
      venues: ["gangil"],
      date: "2026-08-29",
      times: ["18:00~20:00"],
      provider: "gangdong"
    });

    expect((await loadState()).watches.filter((item) => item.userId === pc.user.id)).toEqual([watch]);
    await deleteWatch(watch.id, pc.user.id);
    expect((await loadState()).watches.filter((item) => item.userId === pc.user.id)).toHaveLength(0);
  });

  it("serializes concurrent watch writes without losing either update", async () => {
    const { addWatch, loadState } = await loadStorage();

    await Promise.all([
      addWatch({
        userId: "u1",
        venues: ["gangil"],
        date: "2026-8-27",
        times: ["6:00 ~ 8:00"],
        provider: "gangdong"
      }),
      addWatch({
        userId: "u1",
        venues: ["gangil"],
        date: "2026-08-29",
        times: ["18:00~20:00"],
        provider: "gangdong"
      })
    ]);

    const watches = (await loadState()).watches;
    expect(watches).toHaveLength(2);
    expect(watches[0]).toMatchObject({ date: "2026-08-27", times: ["06:00~08:00"] });
  });

  it("shares Telegram connection state across linked devices", async () => {
    const {
      addInviteCode,
      claimDeviceLinkCode,
      claimInviteCode,
      connectTelegramLinkToken,
      createDeviceLinkCode,
      createTelegramLinkToken,
      getUserBySessionToken
    } = await loadStorage();
    await addInviteCode({ code: "TENNIS-TEL-0001" });
    const pc = await claimInviteCode({ code: "TENNIS-TEL-0001" });
    await connectTelegramLinkToken(await createTelegramLinkToken(pc.user.id), "chat-a");
    const mobile = await claimDeviceLinkCode({ code: (await createDeviceLinkCode(pc.user.id)).code, rateLimitKey: "mobile" });

    const mobileUser = await getUserBySessionToken(mobile.token);
    expect(mobileUser.id).toBe(pc.user.id);
    expect(mobileUser.telegramConnected).toBe(true);
    expect(mobileUser.telegramChatId).toBe("chat-a");
  });

  it("rejects reused and expired device link codes", async () => {
    const { addInviteCode, claimDeviceLinkCode, claimInviteCode, createDeviceLinkCode } = await loadStorage();
    await addInviteCode({ code: "TENNIS-ONCE-0001" });
    const pc = await claimInviteCode({ code: "TENNIS-ONCE-0001" });
    const link = await createDeviceLinkCode(pc.user.id);

    await expect(claimDeviceLinkCode({ code: link.code, rateLimitKey: "mobile-a" })).resolves.toMatchObject({
      user: { id: pc.user.id }
    });
    await expect(claimDeviceLinkCode({ code: link.code, rateLimitKey: "mobile-b" })).rejects.toThrow("유효하지 않거나 만료");

    const expired = await createDeviceLinkCode(pc.user.id, { ttlMs: -1000 });
    await expect(claimDeviceLinkCode({ code: expired.code, rateLimitKey: "mobile-c" })).rejects.toThrow("유효하지 않거나 만료");
  });

  it("rate limits repeated wrong device link attempts", async () => {
    const { claimDeviceLinkCode } = await loadStorage();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(claimDeviceLinkCode({ code: "000-000", rateLimitKey: "same-device" })).rejects.toThrow("유효하지 않거나 만료");
    }
    await expect(claimDeviceLinkCode({ code: "111-111", rateLimitKey: "same-device" })).rejects.toThrow("입력 시도가 너무 많습니다");
  });

  it("does not let a device code switch or modify another user", async () => {
    const {
      addInviteCode,
      addWatch,
      claimDeviceLinkCode,
      claimInviteCode,
      createDeviceLinkCode,
      deleteWatch
    } = await loadStorage();
    await addInviteCode({ code: "TENNIS-A-0001" });
    await addInviteCode({ code: "TENNIS-B-0001" });
    const userA = await claimInviteCode({ code: "TENNIS-A-0001" });
    const userB = await claimInviteCode({ code: "TENNIS-B-0001" });
    const linked = await claimDeviceLinkCode({ code: (await createDeviceLinkCode(userA.user.id)).code, rateLimitKey: "mobile" });
    const bWatch = await addWatch({
      userId: userB.user.id,
      venues: ["gangil"],
      date: "2026-08-29",
      times: ["18:00~20:00"],
      provider: "gangdong"
    });

    expect(linked.user.id).toBe(userA.user.id);
    await expect(deleteWatch(bWatch.id, linked.user.id)).rejects.toThrow("다른 사용자");
  });
});
