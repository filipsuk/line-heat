# @line-heat/server Protocol Reference (Canonical)

This document is the canonical server+client protocol reference for the LineHeat MVP.

- Constants and TypeScript payload types MUST live in `@line-heat/protocol`.
- This README describes the wire contract and algorithms; server and clients should import event names/types from `@line-heat/protocol` and stay aligned with the rules here.

## Environment Variables

Copy/paste (MVP defaults shown):

```bash
export LINEHEAT_TOKEN="devtoken"          # required (fail fast if missing/empty)
export PORT="8787"                        # optional
export LINEHEAT_RETENTION_DAYS="7"         # optional
export LINEHEAT_DB_PATH="/data/lineheat.sqlite" # optional
export LOG_LEVEL="info"                    # optional (debug | info | warn | error)
```

## Handshake Auth Fields (Client -> Server)

Socket.IO handshake MUST include:

`socket.handshake.auth = { token, clientProtocolVersion, userId, displayName, emoji }`

| Field | Required | Type | Rules |
| --- | --- | --- | --- |
| `token` | yes | `string` | exact match with server `LINEHEAT_TOKEN` |
| `clientProtocolVersion` | yes | `string` | semver `major.minor.patch` (parse failure => incompatible) |
| `userId` | yes | `string` | stable UUID persisted locally |
| `displayName` | yes | `string` | trimmed, non-empty, max 64 chars |
| `emoji` | yes | `string` | trimmed, non-empty, max 16 chars |

Server rejects the connection if any required handshake field is missing/invalid.

## Protocol Version Compatibility Rules

Canonical constants (exported by `@line-heat/protocol`):

- `PROTOCOL_VERSION` (a.k.a. `serverProtocolVersion`)
- `MIN_CLIENT_PROTOCOL_VERSION` (a.k.a. `minClientProtocolVersion`)

MVP initial values:

- `PROTOCOL_VERSION = 1.0.0`
- `MIN_CLIENT_PROTOCOL_VERSION = 1.0.0`

Compatibility rule (deterministic):

1. Parse semver `major.minor.patch`.
2. If parse fails => incompatible.
3. If `client.major !== server.major` => incompatible.
4. Else if `client < MIN_CLIENT_PROTOCOL_VERSION` => incompatible.
5. Else compatible.

If incompatible:

- emit `server:incompatible` with `{ serverProtocolVersion, minClientProtocolVersion, message }`
- disconnect

## Server: `server:hello` / `server:incompatible`

Server emits `server:hello` immediately after a successful connection:

`{ serverProtocolVersion, minClientProtocolVersion, serverRetentionDays }`

If protocol is incompatible, server emits `server:incompatible`:

`{ serverProtocolVersion, minClientProtocolVersion, message }`

## Rooms

Room key:

`roomKey = repoId + ":" + filePath`

## Identifier Hashing (`hashVersion`)

To reduce sensitive metadata exposure, clients send hashed identifiers instead of path-like values.

- Hashed identifiers: `repoId`, `filePath`, `functionId`
- Signaling: include `hashVersion` in payloads
- Supported: `hashVersion = "sha256-hex-v1"`

When `hashVersion=sha256-hex-v1`:

- `repoId`, `filePath`, and `functionId` MUST be SHA-256 hex digests: 64 characters, lowercase `[0-9a-f]`.
- The server MUST treat these as opaque identifiers (no git-root/path semantics) and MUST validate by shape + `hashVersion`.

Hashes are unsalted + deterministic (stable across sessions) which means common paths/names may be guessable.

### Identifier Hashing (Required)

This server operates in **hashed-identifier mode only**.

- `hashVersion` is required on all room/edit/presence events.
- `repoId`, `filePath`, `functionId` are **SHA-256 hex** (64 lowercase hex chars).
- The server never needs (and does not expect) plaintext repo names, paths, or symbol names.

## Socket.IO Events (Names + Payload Shapes)

All payloads are JSON, camelCase.

### Client -> Server

| Event | Payload | Ack / Notes |
| --- | --- | --- |
| `room:join` | `{ hashVersion: "sha256-hex-v1", repoId: string, filePath: string }` | Ack: `{ ok: true } \| { ok: false, error: string }` |
| `room:leave` | `{ hashVersion: "sha256-hex-v1", repoId: string, filePath: string }` | no ack |
| `edit:push` | `{ hashVersion: "sha256-hex-v1", repoId: string, filePath: string, functionId: string, anchorLine: number }` | server assigns `serverTs` and persists an event |
| `presence:set` | `{ hashVersion: "sha256-hex-v1", repoId: string, filePath: string, functionId: string, anchorLine: number }` | meaning: active cursor is inside this function |
| `presence:clear` | `{ hashVersion: "sha256-hex-v1", repoId: string, filePath: string }` | meaning: active cursor not inside any function in this file OR editor lost focus |

### Server -> Client

| Event | Payload | Notes |
| --- | --- | --- |
| `server:hello` | `{ serverProtocolVersion, minClientProtocolVersion, serverRetentionDays }` | emitted once on successful connect |
| `server:incompatible` | `{ serverProtocolVersion, minClientProtocolVersion, message }` | emitted before disconnect |
| `room:snapshot` | `{ hashVersion: "sha256-hex-v1", repoId, filePath, functions: Array<{ functionId, anchorLine: number, lastEditAt: number, topEditors: Array<{ userId, displayName, emoji, lastEditAt: number }> }>, presence: Array<{ functionId, anchorLine: number, users: Array<{ userId, displayName, emoji, lastSeenAt: number }> }> }` | emitted after successful `room:join` |
| `file:delta` | `{ hashVersion: "sha256-hex-v1", repoId, filePath, updates: { heat?: Array<{ functionId, anchorLine: number, lastEditAt: number, topEditors: Array<{ userId, displayName, emoji, lastEditAt: number }> }>, presence?: Array<{ functionId, anchorLine: number, users: Array<{ userId, displayName, emoji, lastSeenAt: number }> }> } }` | emitted after edits/presence changes; coalesced |

`room:snapshot` server-provided semantics:

- `topEditors`: max 10, distinct by `userId`, ordered by `lastEditAt` desc
- `presence.users`: max 50 (safety cap), distinct by `userId`, ordered by `lastSeenAt` desc

## Throttling / Coalescing Semantics

Coalesce updates per room; emit at most every 200ms.

Delta aggregation semantics (deterministic):

1. Server maintains a per-room pending delta object.
2. On each ingested event:
   - update in-memory heat/presence state immediately
   - merge the affected `functionId` into the pending delta (keep latest state per `functionId`)
3. Flush timer:
   - at most once every 200ms, emit a single `file:delta` containing both `heat` and `presence` updates accumulated since last flush
4. `room:snapshot` is sent only on `room:join`.

Time authority:

- Server sets `lastEditAt` / `lastSeenAt` using server time to avoid clock skew.

## Server-side Validation + Error Behavior

- General: never throw on bad input; validate and ignore/reject.
- Handshake validation (reject connection if invalid): token, `clientProtocolVersion`, `userId`, `displayName`, `emoji`.
- `room:join`: requires `hashVersion === "sha256-hex-v1"` and validates `repoId`/`filePath` as 64-char lowercase hex; on failure ack `{ ok: false, error: "..." }` and do not join.
- `edit:push` / `presence:set` / `presence:clear`: if payload invalid OR socket is not currently joined to the room: ignore and log at debug level.

## `repoId` Normalization Algorithm

Mechanism (MVP): client derives `repoId` by spawning git:

Note: This section defines the plaintext `repoId` derivation. When sending hashed identifiers, clients hash the derived `repoId` and send the SHA-256 hex string instead.

1. Find git root: `git rev-parse --show-toplevel`.
2. Read remote URL (prefer origin): `git config --get remote.origin.url`.
3. If missing, fall back to the first remote in `git remote -v`.
4. If git fails or remote missing: disable LineHeat for that file (do not emit/subscribe).

Supported remote URL forms (MVP):

- scp-like ssh: `git@host:group/repo.git`
- URL forms: `https://host/group/repo.git`, `ssh://git@host:2222/group/repo.git`, `git://host/group/repo.git`

Not supported (MVP): `file://...` (treat as missing remote).

Normalization (deterministic):

1. Strip credentials/user info.
2. Extract `host` and optional `port`.
   - Default ports by scheme: `ssh=22`, `https=443`, `http=80`, `git=9418`.
   - If explicit port equals default for the scheme, treat it as absent.
3. Extract `path` (everything after host). For scp-like form, split on the first `:`.
4. Normalize:
   - strip leading `/` from path
   - strip trailing `.git` and trailing `/`
   - canonical `hostPart`:
     - hostname lowercased
     - if port present and non-default, append `:${port}`
   - canonical path lowercased (supports GitLab subgroups)
5. Canonical `repoId = ${hostPart}/${path}`.

Examples:

- `git@github.com:Acme/LineHeat.git` -> `github.com/acme/lineheat`
- `https://github.com/Acme/LineHeat` -> `github.com/acme/lineheat`
- `https://user:pass@github.com/Acme/LineHeat.git` -> `github.com/acme/lineheat`
- `https://gitlab.com/Group/SubGroup/Repo.git` -> `gitlab.com/group/subgroup/repo`
- `ssh://git@gitlab.myco.com:2222/Team/Repo.git` -> `gitlab.myco.com:2222/team/repo`

## `functionId` Algorithm (Including Escaping + `anchorLine`)

Note: This section defines the plaintext `functionId` derivation. When sending hashed identifiers, clients hash the derived `functionId` and send the SHA-256 hex string instead.

### Symbol Source

Use `vscode.executeDocumentSymbolProvider` and work with `DocumentSymbol[]`.

Eligible symbol kinds (MVP): `Function`, `Method`, `Constructor`.

### `containerPath` Rules

Build `containerPath` from parent symbols (outermost -> innermost) including kinds:

- `Class`, `Namespace`, `Module`, `Function`

Exclude other parent kinds (e.g. `Interface`) from the path.

### Name Normalization + Escaping

For each path segment (container names and function name):

1. `segmentRaw = symbol.name.trim()`
2. `segment = encodeURIComponent(segmentRaw)`

This avoids ambiguity when names contain `/` or `@`.

### Selection Rule ("Smallest Enclosing")

Given a position (line):

1. Collect all eligible symbols whose `range` contains the position.
2. Choose the symbol with the smallest `range` length (`endLine - startLine`).
3. Tie-breakers: deeper nesting wins; if still tied, pick the first in document order.

### `functionId` String Format

- `functionId = containerPath + "/" + functionName` (URI-escaped segments)
- If no container, `functionId` is just `functionName`.

`anchorLine` metadata (sent separately):

- `anchorLine = selectionRange.start.line + 1` (1-based)

Rationale: stable IDs under line drift plus a deterministic disambiguation hint.

Disambiguation when multiple local symbols match the same `functionId`:

- pick the symbol whose `selectionRange.start.line` is closest to `anchorLine`.

No-symbol fallback (MVP):

- edits: do not emit `edit:push`
- presence: emit `presence:clear`

Edits spanning multiple functions (MVP):

- for each `contentChanges[]`, compute function at start position and end position (if different line)
- emit distinct `edit:push` events for each unique `functionId` encountered

## Subscription Limit (10 Rooms) + LRU Rules

Clients subscribe to file rooms for files open in any tab (active or background), but enforce:

- maximum 10 subscribed file rooms
- when subscribing the 11th file, evict the least-recently-focused subscribed file (LRU)
- never evict the active editor's file

LRU definition (deterministic):

- a file becomes MRU when it becomes the active editor via `vscode.window.onDidChangeActiveTextEditor`
- only subscribed rooms participate in the LRU
- on reconnect, re-join rooms in MRU order, capped to 10 (active editor first)

Initial MRU ordering when many tabs are open (activation/reconnect):

1. active editor file (if eligible)
2. remaining eligible open tabs in current tabGroups order
3. apply 10-room cap by evicting oldest from the tail

Presence emission remains active-editor-only.

## Presence TTL + Keepalive + Editor Transition Clearing

Defaults (shared constant in `@line-heat/protocol`):

- presence TTL: 15 seconds

Server rules:

- `presence:set` refreshes TTL for a `(repoId, filePath, userId)` presence entry.
- server runs cleanup every 5 seconds to evict expired presence.
- on socket disconnect: remove user presence immediately and emit a delta.

Multi-socket behavior per `userId` (deterministic):

- track presence per socket, reduce to per `userId`
- if the same `userId` connects multiple times, keep max `lastSeenAt` across active sockets
- only remove user when all sockets have disconnected or expired

Client keepalive (prevents TTL flicker):

- while active editor is focused and cursor remains inside the same function: re-send `presence:set` every 5 seconds
- when cursor leaves all functions or editor loses focus: send `presence:clear` (best-effort)

Presence clearing on editor transitions (no ghost presence):

- on active editor change: if previous active editor had active presence, immediately send `presence:clear` for previous `{ repoId, filePath }` before setting presence for the new editor
- on window focus loss (if available) or when there is no active editor: send `presence:clear` for the last active `{ repoId, filePath }`

## SQLite Schema + Retention + Cleanup Cadence + Migrations

Driver (MVP): `better-sqlite3`.

DB path: `LINEHEAT_DB_PATH` (default `/data/lineheat.sqlite`).

### Schema (MVP)

Table: `events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY` | |
| `serverTs` | `INTEGER NOT NULL` | server time (ms since epoch) |
| `repoId` | `TEXT NOT NULL` | |
| `filePath` | `TEXT NOT NULL` | |
| `functionId` | `TEXT NOT NULL` | |
| `anchorLine` | `INTEGER NOT NULL` | 1-based |
| `userId` | `TEXT NOT NULL` | |
| `displayName` | `TEXT NOT NULL` | |
| `emoji` | `TEXT NOT NULL` | |

Legacy note: the DB stores whatever identifiers were sent at the time. If you are upgrading from older versions, historical rows may contain plaintext `repoId`/`filePath`/`functionId` unless you wipe/migrate the database.

Indexes:

```sql
CREATE INDEX idx_events_room_ts ON events(repoId, filePath, serverTs);
CREATE INDEX idx_events_ts ON events(serverTs);
```

### Retention

Retention deletion query:

```sql
DELETE FROM events WHERE serverTs < cutoffTs;
```

Cleanup cadence (deterministic):

- once on server startup
- then every 15 minutes

In-memory pruning on retention:

- drop function entries whose `lastEditAt < cutoffTs`
- prune each function's `topEditors` list to only editors with `lastEditAt >= cutoffTs`
- after pruning, next `room:snapshot` MUST NOT include pruned functions

Replay on startup:

```sql
SELECT * FROM events WHERE serverTs >= cutoffTs ORDER BY serverTs ASC;
```

Reduce into in-memory heat state.

### Migrations Approach (MVP)

"Schema-on-start" with explicit migration steps:

- `CREATE TABLE IF NOT EXISTS ...`
- `PRAGMA user_version` to track schema version
- if `user_version` is behind, apply incremental SQL migrations in code

## Performance / Failure Isolation Expectations

- Never block IDE editing: clients treat all networking/git/symbol computation as async and failure-safe.
- Failure-safe behavior: if server is down / protocol incompatible / errors occur, editing remains unaffected; client degrades to a disabled state without unhandled exceptions.
- Server input is untrusted: validate and ignore/reject bad payloads; avoid crashing the process on malformed events.
