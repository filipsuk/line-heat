import { createServer } from "node:http";
import { DEFAULT_RETENTION_DAYS, PROTOCOL_VERSION } from "@line-heat/protocol";

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
const retentionDays = Number.isNaN(parsedRetention)
  ? DEFAULT_RETENTION_DAYS
  : parsedRetention;

const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      status: "ok",
      protocolVersion: PROTOCOL_VERSION,
      retentionDays,
    })
  );
});

server.listen(port, "0.0.0.0", () => {
  console.log(
    `lineheat server listening on 0.0.0.0:${port} (protocol ${PROTOCOL_VERSION})`
  );
});

const shutdown = (signal: string) => {
  console.log(`lineheat server shutting down (${signal})`);
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
