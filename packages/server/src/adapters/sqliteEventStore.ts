import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import type { StoredEditEvent } from "../domain/heatState.js";

const SCHEMA_VERSION = 1;

const MIGRATION_SQL = [
  "CREATE TABLE IF NOT EXISTS events (",
  "  id INTEGER PRIMARY KEY,",
  "  serverTs INTEGER NOT NULL,",
  "  repoId TEXT NOT NULL,",
  "  filePath TEXT NOT NULL,",
  "  functionId TEXT NOT NULL,",
  "  anchorLine INTEGER NOT NULL,",
  "  userId TEXT NOT NULL,",
  "  displayName TEXT NOT NULL,",
  "  emoji TEXT NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_events_room_ts ON events(repoId, filePath, serverTs);",
  "CREATE INDEX IF NOT EXISTS idx_events_ts ON events(serverTs);",
].join("\n");

export class SqliteEventStore {
  private readonly db: Database.Database;
  private readonly dbPath: string;

  constructor(databasePath: string) {
    this.dbPath = databasePath;
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.runMigrations();
  }

  insertEvent(event: StoredEditEvent): void {
    const statement = this.db.prepare(
      "INSERT INTO events (serverTs, repoId, filePath, functionId, anchorLine, userId, displayName, emoji) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    statement.run(
      event.serverTs,
      event.repoId,
      event.filePath,
      event.functionId,
      event.anchorLine,
      event.userId,
      event.displayName,
      event.emoji
    );
  }

  listEventsSince(cutoffTs: number): StoredEditEvent[] {
    const statement = this.db.prepare(
      "SELECT serverTs, repoId, filePath, functionId, anchorLine, userId, displayName, emoji FROM events WHERE serverTs >= ? ORDER BY serverTs ASC"
    );
    return statement.all(cutoffTs) as StoredEditEvent[];
  }

  deleteEventsBefore(cutoffTs: number): number {
    const statement = this.db.prepare(
      "DELETE FROM events WHERE serverTs < ?"
    );
    const info = statement.run(cutoffTs);
    return info.changes;
  }

  close(): void {
    if (!this.dbPath) {
      return;
    }
    this.db.close();
  }

  private runMigrations(): void {
    const currentVersion = this.db.pragma("user_version", {
      simple: true,
    }) as number;

    if (currentVersion >= SCHEMA_VERSION) {
      return;
    }

    const migrate = this.db.transaction(() => {
      this.db.exec(MIGRATION_SQL);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });

    migrate();
  }
}
