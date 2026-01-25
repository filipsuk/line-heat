import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { io as createClient } from "socket.io-client";

import {
  EVENT_EDIT_PUSH,
  EVENT_FILE_DELTA,
  EVENT_PRESENCE_CLEAR,
  EVENT_PRESENCE_SET,
  EVENT_ROOM_JOIN,
  PROTOCOL_VERSION,
} from "@line-heat/protocol";
import type { FileDeltaPayload, RoomJoinAck } from "@line-heat/protocol";

import { SqliteEventStore } from "../../src/adapters/sqliteEventStore.js";
import { createHeatState } from "../../src/domain/heatState.js";
import { createLineHeatServer } from "../../src/server.js";

const TOKEN = "shared-token";

type StartedServer = {
  port: number;
  close: () => Promise<void>;
};

const startServer = async (): Promise<StartedServer> => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lineheat-rt-"));
  const eventStore = new SqliteEventStore(path.join(tempDir, "lineheat.sqlite"));
  const heatState = createHeatState();
  const server = createLineHeatServer({
    token: TOKEN,
    retentionDays: 7,
    eventStore,
    heatState,
  });

  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  const close = async () => {
    await server.close();
    eventStore.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  return { port: address.port, close };
};

const connectClient = (port: number, overrides?: Partial<Record<string, string>>) =>
  createClient(`http://127.0.0.1:${port}`, {
    reconnection: false,
    auth: {
      token: TOKEN,
      clientProtocolVersion: PROTOCOL_VERSION,
      userId: "user-1",
      displayName: "Ada",
      emoji: "🔥",
      ...overrides,
    },
  });

const waitForDelta = (
  client: ReturnType<typeof createClient>,
  predicate: (payload: FileDeltaPayload) => boolean,
  timeoutMs = 1000
): Promise<FileDeltaPayload> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for file:delta"));
    }, timeoutMs);

    const handler = (payload: FileDeltaPayload) => {
      if (predicate(payload)) {
        cleanup();
        resolve(payload);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.off(EVENT_FILE_DELTA, handler);
    };

    client.on(EVENT_FILE_DELTA, handler);
  });

describe("realtime socket server", () => {
  let serverHandle: StartedServer | null = null;

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = null;
    }
  });

  it("rejects invalid token", async () => {
    serverHandle = await startServer();
    const client = connectClient(serverHandle.port, { token: "wrong" });

    const error = await new Promise<Error>((resolve) => {
      client.on("connect_error", resolve);
    });

    client.close();
    expect(error.message).toMatch(/token/i);
  });

  it("broadcasts deltas within the same room", async () => {
    serverHandle = await startServer();
    const clientA = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });
    const clientB = connectClient(serverHandle.port, {
      userId: "user-b",
      displayName: "Grace",
      emoji: "✨",
    });

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId: "repo-1", filePath: "src/index.ts" },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId: "repo-1", filePath: "src/index.ts" },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });

    const deltaPromise = waitForDelta(
      clientB,
      (payload) => payload.repoId === "repo-1" && payload.filePath === "src/index.ts"
    );

    clientA.emit(EVENT_PRESENCE_SET, {
      repoId: "repo-1",
      filePath: "src/index.ts",
      functionId: "main",
      anchorLine: 12,
    });

    const delta = await deltaPromise;
    const presenceUpdate = delta.updates.presence?.[0];
    expect(presenceUpdate?.users[0]?.userId).toBe("user-a");

    clientA.close();
    clientB.close();
  });

  it("isolates broadcasts to the joined room", async () => {
    serverHandle = await startServer();
    const clientA = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });
    const clientB = connectClient(serverHandle.port, {
      userId: "user-b",
      displayName: "Grace",
      emoji: "✨",
    });

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId: "repo-1", filePath: "src/index.ts" },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId: "repo-1", filePath: "src/other.ts" },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });

    const unexpected = new Promise<null>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(null), 400);
      clientB.on(EVENT_FILE_DELTA, () => {
        clearTimeout(timeout);
        reject(new Error("Received unexpected delta"));
      });
    });

    clientA.emit(EVENT_PRESENCE_SET, {
      repoId: "repo-1",
      filePath: "src/index.ts",
      functionId: "main",
      anchorLine: 12,
    });

    await unexpected;
    clientA.close();
    clientB.close();
  });

  it("clears presence within one delta emission", async () => {
    serverHandle = await startServer();
    const clientA = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });
    const clientB = connectClient(serverHandle.port, {
      userId: "user-b",
      displayName: "Grace",
      emoji: "✨",
    });

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId: "repo-1", filePath: "src/index.ts" },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId: "repo-1", filePath: "src/index.ts" },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });

    clientA.emit(EVENT_PRESENCE_SET, {
      repoId: "repo-1",
      filePath: "src/index.ts",
      functionId: "main",
      anchorLine: 12,
    });

    await waitForDelta(
      clientB,
      (payload) => payload.updates.presence?.[0]?.users.length === 1
    );

    const cleared = waitForDelta(
      clientB,
      (payload) =>
        payload.updates.presence?.some(
          (entry) =>
            entry.functionId === "main" &&
            entry.users.every((user) => user.userId !== "user-a")
        ) ?? false
    );

    clientA.emit(EVENT_PRESENCE_CLEAR, {
      repoId: "repo-1",
      filePath: "src/index.ts",
    });

    await cleared;
    clientA.close();
    clientB.close();
  });

  it("emits heat delta after edit:push", async () => {
    serverHandle = await startServer();
    const clientA = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });
    const clientB = connectClient(serverHandle.port, {
      userId: "user-b",
      displayName: "Grace",
      emoji: "✨",
    });

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId: "repo-1", filePath: "src/index.ts" },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId: "repo-1", filePath: "src/index.ts" },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });

    const deltaPromise = waitForDelta(
      clientB,
      (payload) =>
        payload.repoId === "repo-1" &&
        payload.filePath === "src/index.ts" &&
        payload.updates.heat?.some((heat) => heat.functionId === "main") === true
    );

    clientA.emit(EVENT_EDIT_PUSH, {
      repoId: "repo-1",
      filePath: "src/index.ts",
      functionId: "main",
      anchorLine: 12,
    });

    const delta = await deltaPromise;
    
    expect(delta.repoId).toBe("repo-1");
    expect(delta.filePath).toBe("src/index.ts");
    expect(delta.updates.heat).toBeDefined();
    expect(Array.isArray(delta.updates.heat)).toBe(true);
    expect(delta.updates.heat?.length).toBeGreaterThan(0);

    const heatUpdate = delta.updates.heat?.find((h) => h.functionId === "main");
    expect(heatUpdate).toBeDefined();
    expect(heatUpdate?.functionId).toBe("main");
    expect(heatUpdate?.anchorLine).toBe(12);
    expect(heatUpdate?.lastEditAt).toBeTypeOf("number");
    expect(Array.isArray(heatUpdate?.topEditors)).toBe(true);
    
    const editorEntry = heatUpdate?.topEditors?.find((editor) => editor.userId === "user-a");
    expect(editorEntry).toBeDefined();
    expect(editorEntry?.userId).toBe("user-a");
    expect(editorEntry?.displayName).toBe("Ada");
    expect(editorEntry?.emoji).toBe("🔥");
    expect(editorEntry?.lastEditAt).toBeTypeOf("number");

    clientA.close();
    clientB.close();
  });
});
