import { DEFAULT_RETENTION_DAYS, PROTOCOL_VERSION } from "@line-heat/protocol";

import { SqliteEventStore } from "./adapters/sqliteEventStore.js";
import { replayHeatState } from "./application/heatReplay.js";
import { pruneHeatState } from "./domain/heatState.js";
import { createLineHeatServer } from "./server.js";

const token = process.env.LINEHEAT_TOKEN?.trim() ?? "";

if (!token) {
  console.error("LINEHEAT_TOKEN is required to start the server.");
  process.exit(1);
}

const portEnv = process.env.PORT ?? "";
const parsedPort = Number.parseInt(portEnv, 10);
const port = Number.isNaN(parsedPort) ? 8787 : parsedPort;

const retentionEnv = process.env.LINEHEAT_RETENTION_DAYS ?? "";
const parsedRetention = Number.parseInt(retentionEnv, 10);
const retentionDays =
  Number.isNaN(parsedRetention) || parsedRetention <= 0
    ? DEFAULT_RETENTION_DAYS
    : parsedRetention;

const dbPath =
  process.env.LINEHEAT_DB_PATH?.trim() ||
  `${process.cwd()}/.lineheat/lineheat.sqlite`;

const eventStore = new SqliteEventStore(dbPath);
const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
const retentionCutoff = Date.now() - retentionMs;
eventStore.deleteEventsBefore(retentionCutoff);
const retainedEvents = eventStore.listEventsSince(retentionCutoff);
const heatState = replayHeatState(retainedEvents);

const retentionIntervalMs = 15 * 60 * 1000;
const retentionInterval = setInterval(() => {
  const cutoffTs = Date.now() - retentionMs;
  eventStore.deleteEventsBefore(cutoffTs);
  pruneHeatState(heatState, cutoffTs);
}, retentionIntervalMs);

const lineHeatServer = createLineHeatServer({
  token,
  retentionDays,
  eventStore,
  heatState,
});

lineHeatServer.httpServer.listen(port, "0.0.0.0", () => {
  console.log(
    `lineheat server listening on 0.0.0.0:${port} (protocol ${PROTOCOL_VERSION})`
  );
});

const shutdown = (signal: string) => {
  console.log(`lineheat server shutting down (${signal})`);
  lineHeatServer.close().then(() => {
    clearInterval(retentionInterval);
    eventStore.close();
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
