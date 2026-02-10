import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { io as createClient } from "socket.io-client";

import {
  EVENT_EDIT_PUSH,
  EVENT_REPO_HEAT,
  EVENT_ROOM_JOIN,
  HASH_VERSION,
  PROTOCOL_VERSION,
  sha256Hex,
} from "@line-heat/protocol";
import type { RoomJoinAck, RepoHeatResponse } from "@line-heat/protocol";

import { SqliteEventStore } from "../../src/adapters/sqliteEventStore.js";
import { createHeatState } from "../../src/domain/heatState.js";
import { createLineHeatServer } from "../../src/server.js";

const TOKEN = "shared-token";

type StartedServer = {
  port: number;
  close: () => Promise<void>;
};

const startServer = async (): Promise<StartedServer> => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lineheat-rh-"));
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

const joinRoom = (
  client: ReturnType<typeof createClient>,
  repoId: string,
  filePath: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    client.emit(
      EVENT_ROOM_JOIN,
      { repoId, filePath, hashVersion: HASH_VERSION },
      (ack: RoomJoinAck) => (ack.ok ? resolve() : reject(new Error(ack.error)))
    );
  });

const pushEdit = (
  client: ReturnType<typeof createClient>,
  repoId: string,
  filePath: string,
  functionId: string,
  anchorLine: number
): void => {
  client.emit(EVENT_EDIT_PUSH, {
    hashVersion: HASH_VERSION,
    repoId,
    filePath,
    functionId,
    anchorLine,
  });
};

const emitRepoHeat = (
  client: ReturnType<typeof createClient>,
  repoId: string
): Promise<RepoHeatResponse> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("repo:heat ack timed out")),
      2000
    );
    client.emit(
      EVENT_REPO_HEAT,
      { repoId, hashVersion: HASH_VERSION },
      (response: RepoHeatResponse) => {
        clearTimeout(timeout);
        resolve(response);
      }
    );
  });

/** Small pause so server processes the edit:push before we query. */
const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms));

describe("repo:heat", () => {
  let serverHandle: StartedServer | null = null;

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = null;
    }
  });

  it("returns file-level max heat excluding self", async () => {
    serverHandle = await startServer();
    const repoId = sha256Hex("repo-1");
    const filePath = sha256Hex("src/index.ts");
    const functionId = sha256Hex("main");

    // User A edits
    const clientA = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });
    await joinRoom(clientA, repoId, filePath);
    pushEdit(clientA, repoId, filePath, functionId, 10);
    await tick();

    // User B queries — should see user-a's heat
    const clientB = connectClient(serverHandle.port, {
      userId: "user-b",
      displayName: "Grace",
      emoji: "✨",
    });
    // No room:join required for repo:heat
    const response = await emitRepoHeat(clientB, repoId);

    expect(response.files).toBeDefined();
    expect(response.files[filePath]).toBeTypeOf("number");
    expect(response.files[filePath]).toBeGreaterThan(0);

    clientA.close();
    clientB.close();
  });

  it("returns empty for unknown repoId", async () => {
    serverHandle = await startServer();
    const unknownRepoId = sha256Hex("nonexistent-repo");

    const client = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });

    const response = await emitRepoHeat(client, unknownRepoId);

    expect(response.files).toBeDefined();
    expect(Object.keys(response.files)).toHaveLength(0);

    client.close();
  });

  it("excludes files where only self edited", async () => {
    serverHandle = await startServer();
    const repoId = sha256Hex("repo-solo");
    const filePath = sha256Hex("src/only-mine.ts");
    const functionId = sha256Hex("myFunc");

    // User A edits a file
    const clientA = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });
    await joinRoom(clientA, repoId, filePath);
    pushEdit(clientA, repoId, filePath, functionId, 5);
    await tick();

    // User A queries — should NOT see own file (no other editors)
    const response = await emitRepoHeat(clientA, repoId);

    expect(response.files).toBeDefined();
    expect(response.files[filePath]).toBeUndefined();

    clientA.close();
  });

  it("returns multiple files from same repo", async () => {
    serverHandle = await startServer();
    const repoId = sha256Hex("repo-multi");
    const fileA = sha256Hex("src/a.ts");
    const fileB = sha256Hex("src/b.ts");
    const fnA = sha256Hex("fnA");
    const fnB = sha256Hex("fnB");

    // User A edits two files
    const clientA = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });
    await joinRoom(clientA, repoId, fileA);
    await joinRoom(clientA, repoId, fileB);
    pushEdit(clientA, repoId, fileA, fnA, 1);
    pushEdit(clientA, repoId, fileB, fnB, 2);
    await tick();

    // User B queries — should see both files
    const clientB = connectClient(serverHandle.port, {
      userId: "user-b",
      displayName: "Grace",
      emoji: "✨",
    });
    const response = await emitRepoHeat(clientB, repoId);

    expect(response.files).toBeDefined();
    expect(Object.keys(response.files)).toHaveLength(2);
    expect(response.files[fileA]).toBeTypeOf("number");
    expect(response.files[fileB]).toBeTypeOf("number");

    clientA.close();
    clientB.close();
  });

  it("gracefully handles invalid repoId (returns empty, no crash)", async () => {
    serverHandle = await startServer();

    const client = connectClient(serverHandle.port, {
      userId: "user-a",
      displayName: "Ada",
      emoji: "🔥",
    });

    // Invalid repoId — not a valid sha256 hex
    const response = await emitRepoHeat(client, "not-a-valid-hash");

    expect(response.files).toBeDefined();
    expect(Object.keys(response.files)).toHaveLength(0);

    client.close();
  });
});
