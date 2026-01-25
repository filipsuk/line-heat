import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteEventStore } from "../../src/adapters/sqliteEventStore.js";
import { replayHeatState } from "../../src/application/heatReplay.js";
import { getRoomKey } from "../../src/domain/heatState.js";
import type { StoredEditEvent } from "../../src/domain/heatState.js";

const baseEvent: StoredEditEvent = {
  serverTs: 0,
  repoId: "repo-1",
  filePath: "src/index.ts",
  functionId: "main",
  anchorLine: 10,
  userId: "user-1",
  displayName: "Ada",
  emoji: "🔥",
};

const withEvent = (
  overrides: Partial<StoredEditEvent>
): StoredEditEvent => ({
  ...baseEvent,
  ...overrides,
});

describe("sqlite event store", () => {
  let tempDir: string;
  let store: SqliteEventStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lineheat-server-"));
    store = new SqliteEventStore(path.join(tempDir, "lineheat.sqlite"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("deletes events older than retention cutoff", () => {
    store.insertEvent(withEvent({ serverTs: 1000, functionId: "old" }));
    store.insertEvent(withEvent({ serverTs: 2000, functionId: "new" }));

    store.deleteEventsBefore(1500);

    const remaining = store.listEventsSince(0);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.serverTs).toBe(2000);
    expect(remaining[0]?.functionId).toBe("new");
  });

  it("replays retained events into heat state", () => {
    const events = [
      withEvent({ serverTs: 1000, userId: "user-1", displayName: "Ada" }),
      withEvent({
        serverTs: 2000,
        userId: "user-2",
        displayName: "Grace",
        emoji: "✨",
      }),
      withEvent({
        serverTs: 3000,
        userId: "user-1",
        displayName: "Ada Lovelace",
        anchorLine: 12,
      }),
    ];

    const state = replayHeatState(events);
    const room = state.get(getRoomKey(baseEvent.repoId, baseEvent.filePath));
    expect(room).toBeDefined();

    const heatFunction = room?.functions.get(baseEvent.functionId);
    expect(heatFunction?.lastEditAt).toBe(3000);
    expect(heatFunction?.anchorLine).toBe(12);
    expect(heatFunction?.topEditors).toEqual([
      {
        userId: "user-1",
        displayName: "Ada Lovelace",
        emoji: "🔥",
        lastEditAt: 3000,
      },
      {
        userId: "user-2",
        displayName: "Grace",
        emoji: "✨",
        lastEditAt: 2000,
      },
    ]);
  });
});
