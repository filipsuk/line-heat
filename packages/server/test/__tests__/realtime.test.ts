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
  EVENT_ROOM_SNAPSHOT,
  EVENT_SERVER_INCOMPATIBLE,
  HASH_VERSION,
  PROTOCOL_VERSION,
  sha256Hex,
} from "@line-heat/protocol";
import type { FileDeltaPayload, RoomJoinAck, RoomSnapshotPayload } from "@line-heat/protocol";

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

const waitForSnapshot = (
  client: ReturnType<typeof createClient>,
  predicate: (payload: RoomSnapshotPayload) => boolean,
  timeoutMs = 1000
): Promise<RoomSnapshotPayload> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for room:snapshot"));
    }, timeoutMs);

    const handler = (payload: RoomSnapshotPayload) => {
      if (predicate(payload)) {
        cleanup();
        resolve(payload);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.off(EVENT_ROOM_SNAPSHOT, handler);
    };

    client.on(EVENT_ROOM_SNAPSHOT, handler);
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

    const repoId = sha256Hex("repo-1");
    const filePath = sha256Hex("src/index.ts");

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });

    const deltaPromise = waitForDelta(
      clientB,
      (payload) => payload.repoId === repoId && payload.filePath === filePath
    );

    clientA.emit(EVENT_PRESENCE_SET, {
      hashVersion: HASH_VERSION,
      repoId,
      filePath,
      functionId: sha256Hex("main"),
      anchorLine: 12,
    });

    const delta = await deltaPromise;
    const presenceUpdate = delta.updates.presence?.[0];
    expect(presenceUpdate?.users[0]?.userId).toBe("user-a");

    clientA.close();
    clientB.close();
  });

  it("accepts hashed identifiers when hashVersion is provided", async () => {
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
    const repoId = sha256Hex("repo");
    const filePath = sha256Hex("file");
    const functionId = sha256Hex("fn");

    const snapshotPromise = waitForSnapshot(
      clientA,
      (payload) => payload.repoId === repoId && payload.filePath === filePath,
      1000
    );

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    const snapshot = await snapshotPromise;
    expect(snapshot.hashVersion).toBe(HASH_VERSION);
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });

    const deltaPromise = waitForDelta(
      clientB,
      (payload) =>
        payload.repoId === repoId &&
        payload.filePath === filePath &&
        payload.updates.heat?.some((heat) => heat.functionId === functionId) ===
          true
    );

    clientA.emit(EVENT_EDIT_PUSH, {
      repoId,
      filePath,
      functionId,
      anchorLine: 12,
      hashVersion: HASH_VERSION,
    });

    const delta = await deltaPromise;
    expect(delta.hashVersion).toBe(HASH_VERSION);
    expect(delta.repoId).toBe(repoId);
    expect(delta.filePath).toBe(filePath);
    expect(delta.updates.heat?.some((heat) => heat.functionId === functionId)).toBe(
      true
    );

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

    const repoId = sha256Hex("repo-1");
    const filePathA = sha256Hex("src/index.ts");
    const filePathB = sha256Hex("src/other.ts");

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath: filePathA, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath: filePathB, hashVersion: HASH_VERSION },
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
      hashVersion: HASH_VERSION,
      repoId,
      filePath: filePathA,
      functionId: sha256Hex("main"),
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

    const repoId = sha256Hex("repo-1");
    const filePath = sha256Hex("src/index.ts");
    const functionId = sha256Hex("main");

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });

    clientA.emit(EVENT_PRESENCE_SET, {
      hashVersion: HASH_VERSION,
      repoId,
      filePath,
      functionId,
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
            entry.functionId === functionId &&
            entry.users.every((user) => user.userId !== "user-a")
        ) ?? false
    );

    clientA.emit(EVENT_PRESENCE_CLEAR, {
      hashVersion: HASH_VERSION,
      repoId,
      filePath,
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

    const repoId = sha256Hex("repo-1");
    const filePath = sha256Hex("src/index.ts");
    const functionId = sha256Hex("main");

    await new Promise<void>((resolve, reject) => {
      clientA.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });
    await new Promise<void>((resolve, reject) => {
      clientB.emit(
        EVENT_ROOM_JOIN,
        { repoId, filePath, hashVersion: HASH_VERSION },
        (ack: RoomJoinAck) =>
          ack.ok ? resolve() : reject(new Error(ack.error))
      );
    });

    const deltaPromise = waitForDelta(
      clientB,
      (payload) =>
        payload.repoId === repoId &&
        payload.filePath === filePath &&
        payload.updates.heat?.some((heat) => heat.functionId === functionId) === true
    );

    clientA.emit(EVENT_EDIT_PUSH, {
      hashVersion: HASH_VERSION,
      repoId,
      filePath,
      functionId,
      anchorLine: 12,
    });

    const delta = await deltaPromise;

    expect(delta.hashVersion).toBe(HASH_VERSION);
    expect(delta.repoId).toBe(repoId);
    expect(delta.filePath).toBe(filePath);
    expect(delta.updates.heat).toBeDefined();
    expect(Array.isArray(delta.updates.heat)).toBe(true);
    expect(delta.updates.heat?.length).toBeGreaterThan(0);

    const heatUpdate = delta.updates.heat?.find((h) => h.functionId === functionId);
    expect(heatUpdate).toBeDefined();
    expect(heatUpdate?.functionId).toBe(functionId);
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

  it("disconnects client with incompatible protocol version", async () => {
    serverHandle = await startServer();
    const client = connectClient(serverHandle.port, { 
      clientProtocolVersion: "1.0.0"
    });

    const incompatibleEvent = await new Promise<any>((resolve) => {
      client.on(EVENT_SERVER_INCOMPATIBLE, resolve);
    });

    expect(incompatibleEvent).toBeDefined();
    expect(incompatibleEvent.serverProtocolVersion).toBe(PROTOCOL_VERSION);
    expect(incompatibleEvent.minClientProtocolVersion).toBeDefined();
    expect(incompatibleEvent.message).toContain("major version");
    
    await new Promise<void>((resolve, reject) => {
      if (client.disconnected) {
        resolve();
        return;
      }
      
      client.on("disconnect", () => {
        resolve();
      });
      
      setTimeout(() => {
        reject(new Error("Client did not disconnect within timeout"));
      }, 1000);
    });
    
    expect(client.disconnected).toBe(true);
    
    client.close();
  });
});
