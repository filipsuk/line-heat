import { createServer } from "node:http";
import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";

import { PROTOCOL_VERSION } from "@line-heat/protocol";

import type { HeatState } from "./domain/heatState.js";
import type { SqliteEventStore } from "./adapters/sqliteEventStore.js";
import { attachRealtimeServer } from "./adapters/realtimeServer.js";

export type LineHeatServer = {
  httpServer: HttpServer;
  close: () => Promise<void>;
};

export type LineHeatServerOptions = {
  token: string;
  retentionDays: number;
  eventStore: SqliteEventStore;
  heatState: HeatState;
};

export const createLineHeatServer = (
  options: LineHeatServerOptions
): LineHeatServer => {
  const { token, retentionDays, eventStore, heatState } = options;

  const httpServer = createServer((_, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "ok",
        protocolVersion: PROTOCOL_VERSION,
        retentionDays,
      })
    );
  });

  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const realtime = attachRealtimeServer({
    io,
    token,
    retentionDays,
    eventStore,
    heatState,
  });

  return {
    httpServer,
    close: () =>
      new Promise((resolve) => {
        realtime.close();
        io.close(() => {
          httpServer.close(() => {
            resolve();
          });
        });
      }),
  };
};
