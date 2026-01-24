# LineHeat MVP (Internal Trial) Work Plan

## Context

### Original Request
Validate the current repo docs/commit, interview for product requirements, then create a plan for the fastest internal MVP.

### Interview Summary (Decisions)
- Target: internal MVP ASAP for ~15 devs; TypeScript codebases; VS Code-only for MVP.
 - Product stance: show name + emoji avatar to enable coordination, but avoid "spying" via: no global view + no file content sharing.
- Heat: function-level, derived from VS Code symbols; heat comes from edits only.
- Presence: only when cursor is inside a function; emitted from active editor only.
- Subscription: receive updates while a file is open in any tab (active or background).
- Attribution: show top 3 most recent editors per function (within heat window).
- Decay: configurable in extension settings; default 24h.
- Backend: Node + TypeScript, Docker-first, lightweight deps, DDD + hexagonal + DI.
- Sync: self-hosted Socket.IO.
- Auth: shared team token required.
- Repo identity: derived from git remote URL.
- Storage: persist raw events in SQLite; computed heat + live presence in memory.
- Retention: delete old events; configurable; default 1 week.
- Transparency: extension shows configured retention (MVP: hardcoded but centralized for future).
- Tests: TDD; server unit tests (domain) + gray-box e2e tests; Vitest chosen for backend.
- Out of scope (MVP): invite-first "follow" mode; JetBrains support.

### Validation (Docs/Commit)
- Last commit `fd3e860c9ffdeed55923cc0e398fa1ebcb9d14c9` updates only `PLAN.md` and aligns with repo direction.
- Existing extension currently logs `filePath:line` on edits (`packages/vscode-extension/src/extension.ts`).

### Repository Docs Status (Important)
- Until Task 15 lands, treat this plan (`.sisyphus/plans/lineheat-mvp.md`) as the authoritative MVP spec.
- `README.md` and `PLAN.md` contain earlier narrative/options (e.g., anonymity phrasing, OAuth mentions) that will be updated to match MVP decisions in Task 14.

### Metis Review (Gaps Addressed)
- User identity stability: generate/store a client UUID; do not rely on display name uniqueness.
- Time authority: server timestamps events to avoid clock-skew issues; use server time for ordering + decay.
- Git remote normalization: define deterministic mapping (prefer `origin`, normalize ssh/https) for stable `repoId`.
- Guardrails: no global dashboards, no cross-file analytics, no line-level heat, no background-tab presence emission.

---

## Work Objectives

### Core Objective
Ship a self-hostable VS Code MVP that shows function-level heat + live presence for teammates, enabling quick coordination and reducing parallel-work collisions.

### Concrete Deliverables
- A self-hosted server (`packages/server`) that accepts Socket.IO connections, enforces a shared team token, stores events in SQLite, and broadcasts per-file heat/presence updates.
- A VS Code extension (`packages/vscode-extension`) that:
  - derives `repoId` from git remote
  - identifies the edited/current function via VS Code document symbols
  - emits edit and presence events
  - renders per-function heat-by-recency + top-3 most recent editors + live presence
  - shows retention window in UI/settings
- Updated docs describing privacy stance, retention, and debugging via `docker exec`.

### Definition of Done
- Internal trial can be run from a single Docker container for the server + VS Code extension configured with server URL + token.
- Two developers can open the same file and see:
  - live presence moving as the active cursor changes functions
  - heat appearing on edited functions and decaying over time
  - top-3 most recent editors per function
- Server unit tests and e2e tests pass locally.
- Existing extension tests still pass (updated as needed).

### Must NOT Have (Guardrails)
- No global/team-wide activity screen or API.
- No file contents, code diffs, or keystroke data transmitted or stored.
- No line-level heat in MVP.
- No presence emission from background tabs.
- No OAuth / user database in MVP.
- No remote SQLite access; debug via `docker exec` only.

### Privacy Notes (Explicit)
- Use emoji avatars in MVP (no remote avatar fetching).

---

## MVP Technical Spec (To Remove Guesswork)

### Contract As Code (Single Source of Truth)

To avoid drifting server/extension payload types, the MVP will introduce a tiny internal workspace package:

- `packages/protocol` (new, package name `@line-heat/protocol`)
  - exports TypeScript types + runtime constants used by BOTH:
- `packages/server`
- `packages/vscode-extension`
  - contents (MVP):
    - event payload types for all Socket.IO events
    - constant event names (string literals)
    - shared constants (presence TTL default, retention default, max string lengths)

This package is the canonical source; server and extension must import from it.

**Module/build compatibility (explicit)**
- VS Code extensions commonly run as CJS, while the server is ESM.
- `@line-heat/protocol` must therefore build dual outputs:
  - `dist/cjs/*` (CommonJS) for the extension
  - `dist/esm/*` (ESM) for the server
- `packages/protocol/package.json` must include an `exports` map supporting both `import` and `require`.
- The code should be written as plain TS modules (no Node-only APIs) so it works in both targets.

**Build approach (make this deterministic)**
- Build with `tsc` twice (no bundler):
  - `packages/protocol/tsconfig.esm.json` -> `dist/esm` (ESM)
  - `packages/protocol/tsconfig.cjs.json` -> `dist/cjs` (CJS)
- Avoid `.cjs` renames by placing a nested package.json under `dist/cjs/`:
  - create `dist/cjs/package.json` with `{ "type": "commonjs" }`
  - this makes `dist/cjs/index.js` loadable via `require(...)` even if the root package is ESM

**Concrete package.json spec (MVP)**
- `packages/protocol/package.json` must include:
  - `"name": "@line-heat/protocol"`
  - `"type": "module"`
  - `"main": "./dist/cjs/index.js"`
  - `"module": "./dist/esm/index.js"`
  - `"types": "./dist/types/index.d.ts"`
  - `"exports"`:
    - `"."`:
      - `"types": "./dist/types/index.d.ts"`
      - `"import": "./dist/esm/index.js"`
      - `"require": "./dist/cjs/index.js"`

**Concrete tsconfig spec (MVP)**
- `tsconfig.esm.json`:
  - `compilerOptions.module = "ESNext"`
  - `compilerOptions.moduleResolution = "NodeNext"`
  - `compilerOptions.outDir = "dist/esm"`
  - `compilerOptions.declaration = true`
  - `compilerOptions.declarationDir = "dist/types"`
  - `compilerOptions.target = "ES2022"`
- `tsconfig.cjs.json`:
  - `compilerOptions.module = "CommonJS"`
  - `compilerOptions.outDir = "dist/cjs"`
  - `compilerOptions.declaration = false`
  - `compilerOptions.target = "ES2022"`

**Build scripts (MVP)**
- `npm run build -w @line-heat/protocol` must:
  - run ESM build
  - run CJS build
  - ensure `dist/cjs/package.json` exists

**Protocol source layout (MVP)**
- Entry file: `packages/protocol/src/index.ts`
- Organize exports:
  - `PROTOCOL_VERSION`, `MIN_CLIENT_PROTOCOL_VERSION`
  - event name constants (e.g., `EVENT_ROOM_JOIN = "room:join"`)
  - payload TypeScript types

### Socket.IO Wire Protocol (Event Names + Payloads)

All payloads are JSON, camelCase.

**Handshake (client -> server)**
- Connection must include `token` and user identity in Socket.IO handshake auth:
  - `socket.handshake.auth = { token, clientProtocolVersion, userId, displayName, emoji }`
- Required vs optional:
  - `token`: REQUIRED
  - `clientProtocolVersion`: REQUIRED (semver string, e.g. `1.0.0`)
  - `userId`: REQUIRED (stable UUID persisted locally)
  - `displayName`: REQUIRED (trimmed; max 64 chars)
  - `emoji`: REQUIRED (trimmed; max 16 chars)
- Server rejects connection if token missing/invalid.

**Protocol compatibility**
- Canonical constants live in `@line-heat/protocol`:
  - `PROTOCOL_VERSION` (serverProtocolVersion)
  - `MIN_CLIENT_PROTOCOL_VERSION` (minClientProtocolVersion)
- Initial MVP values:
  - `PROTOCOL_VERSION = 1.0.0`
  - `MIN_CLIENT_PROTOCOL_VERSION = 1.0.0`
- Compatibility rule (MVP):
  - Parse semver `major.minor.patch`
  - If parse fails => incompatible
  - If `client.major !== server.major` => incompatible
  - Else if `client < MIN_CLIENT_PROTOCOL_VERSION` => incompatible
  - Else compatible
- If incompatible:
  - emit `server:incompatible` with `{ serverProtocolVersion, minClientProtocolVersion, message }`
  - disconnect
- Extension prompts the user to update the extension when it receives `server:incompatible`.

**Token validation**
- Server reads required env var `LINEHEAT_TOKEN` and performs exact string match.

**Startup behavior if token missing**
- If `LINEHEAT_TOKEN` is unset/empty: fail fast on boot (exit non-zero).

**Other server config defaults (MVP)**
- `PORT`: default `8787`
- `LINEHEAT_RETENTION_DAYS`: default `7`
- `LINEHEAT_DB_PATH`: default `/data/lineheat.sqlite`

**Server metadata**
- Server emits `server:hello` immediately after connection success:
  - Payload: `{ serverProtocolVersion, minClientProtocolVersion, serverRetentionDays }`
- Extension stores and displays `serverRetentionDays` (privacy transparency).
  - display locations (MVP): status bar item + hover tooltip

**Rooms**
- Room key: `repoId + ":" + filePath`
- `filePath` MUST be git-root-relative with `/` separators and max 512 chars.
- For a given file:
  - find git root via `git rev-parse --show-toplevel`
  - compute `filePath = relativePath(gitRoot, file)`
- Normalize `filePath` across OSes:
  - convert path separators `\\` -> `/`
  - reject if `filePath` starts with `../` or is empty
- Files not in a git repo (or where git commands fail): do not subscribe and do not emit.

**Client -> Server events**
- `room:join`
  - Payload: `{ repoId: string, filePath: string }`
  - Ack: `{ ok: true } | { ok: false, error: string }`
- `room:leave`
  - Payload: `{ repoId: string, filePath: string }`
- `edit:push`
  - Payload: `{ repoId: string, filePath: string, functionId: string, anchorLine: number }`
  - Server assigns `serverTs` and persists an event.
- `presence:set`
  - Payload: `{ repoId: string, filePath: string, functionId: string, anchorLine: number }`
  - Meaning: "my active cursor is inside this function"
- `presence:clear`
  - Payload: `{ repoId: string, filePath: string }`
  - Meaning: "my active cursor is not inside any function in this file" or editor lost focus.

**Server -> Client events**
- `server:hello`
  - Payload: `{ serverProtocolVersion, minClientProtocolVersion, serverRetentionDays }`
  - Emitted once on successful connect.
- `server:incompatible`
  - Payload: `{ serverProtocolVersion, minClientProtocolVersion, message }`
  - Emitted before disconnect when client protocol is unsupported.
- `room:snapshot`
  - Payload:
    - `{ repoId, filePath, functions: Array<{ functionId, anchorLine: number, lastEditAt: number, topEditors: Array<{ userId, displayName, emoji, lastEditAt: number }> }>, presence: Array<{ functionId, anchorLine: number, users: Array<{ userId, displayName, emoji, lastSeenAt: number }> }> }`
  - `topEditors` semantics (server-provided):
    - max 10 entries
    - distinct by `userId`
    - ordered by `lastEditAt` desc
  - `presence.users` semantics (server-provided):
    - distinct by `userId`
    - ordered by `lastSeenAt` desc
    - max 50 users (safety cap)
  - Emitted immediately after successful `room:join`.
- `file:delta`
  - Payload:
    - `{ repoId, filePath, updates: { heat?: Array<{ functionId, anchorLine: number, lastEditAt: number, topEditors: Array<{ userId, displayName, emoji, lastEditAt: number }> }>, presence?: Array<{ functionId, anchorLine: number, users: Array<{ userId, displayName, emoji, lastSeenAt: number }> }> } }`
  - Emitted after edits/presence changes; server coalesces deltas.

**Throttling / coalescing rule (MVP)**
- Coalesce updates per room; emit at most every 200ms.
- Goal: visible updates "usually within 1s" for a human.

**Delta aggregation semantics (deterministic)**
- Server maintains a per-room pending delta object.
- On each ingested event:
  - update in-memory heat/presence state immediately
  - merge the affected functionId into the pending delta (keep latest state per functionId)
- Flush timer:
  - at most once every 200ms, emit a single `file:delta` containing both `heat` and `presence` updates accumulated since last flush
- `room:snapshot` is sent only on `room:join`.

**Time authority**
- Server sets `lastEditAt` / `lastSeenAt` using server time to avoid clock skew.

### Server-side Validation + Error Behavior (MVP)

- General: never throw on bad input; validate and ignore/reject.
- Handshake validation (reject connection if invalid):
  - missing/invalid token
  - missing/invalid `clientProtocolVersion`
  - missing/invalid `userId`/`displayName`/`emoji`
- `room:join`:
  - validate `repoId` and `filePath` (non-empty, <=512 chars, no `..`, no leading `/`)
  - on failure: ack `{ ok: false, error: "..." }` and do not join
- `edit:push` / `presence:set` / `presence:clear`:
  - if payload invalid or socket not currently joined to the room: ignore and log at debug level

### repoId Derivation (Chosen Mechanism + Normalization)

**Mechanism (MVP choice: spawn git)**
- For each file event, find the git root by running in the file's directory:
  - `git rev-parse --show-toplevel`
- Then read remote URL (prefer origin):
  - `git config --get remote.origin.url`
  - If missing, fall back to the first remote in `git remote -v`.
- If git commands fail, extension disables LineHeat for that file and does not emit.

**Multi-root workspace behavior**
- repoId is resolved per file (based on that file's git root).

**Normalization**
- Supported remote URL forms (MVP):
  - scp-like ssh: `git@host:group/repo.git`
  - URL forms: `https://host/group/repo.git`, `ssh://git@host:2222/group/repo.git`, `git://host/group/repo.git`
- Explicitly NOT supported (MVP): `file://...` (treat as missing remote -> disable)

Algorithm (deterministic):
1) Strip credentials/user info.
2) Extract `host` and optional `port`.
   - Default ports by scheme:
     - `ssh`: 22
     - `https`: 443
     - `http`: 80
     - `git`: 9418
   - If an explicit port equals the scheme default, treat it as absent.
3) Extract `path` (everything after host). For scp-like form, split on the first `:`.
4) Normalize:
   - strip leading `/` from path
   - strip trailing `.git` and trailing `/`
   - canonical hostPart is:
     - `hostname` lowercased
     - if port is present and non-default, append `:${port}`
   - canonical path lowercased (supports GitLab subgroups)
5) Canonical repoId = `${hostPart}/${path}`.

Examples:
Examples:
- `git@github.com:Acme/LineHeat.git` -> `github.com/acme/lineheat`
- `https://github.com/Acme/LineHeat` -> `github.com/acme/lineheat`
- `https://user:pass@github.com/Acme/LineHeat.git` -> `github.com/acme/lineheat`

Deterministic casing examples (MVP):
- `git@github.com:Acme/LineHeat.git` -> `github.com/acme/lineheat`
- `https://gitlab.com/Group/SubGroup/Repo.git` -> `gitlab.com/group/subgroup/repo`
- `ssh://git@gitlab.myco.com:2222/Team/Repo.git` -> `gitlab.myco.com:2222/team/repo`

### functionId Algorithm (Symbols -> Deterministic ID)

**Symbol source**
- Use `vscode.executeDocumentSymbolProvider` and work with `DocumentSymbol[]`.

**Eligible symbol kinds (MVP)**
- `Function`, `Method`, `Constructor`.

**containerPath rules (deterministic)**
- Build `containerPath` from parent symbols (outermost -> innermost) including these kinds:
  - `Class`, `Namespace`, `Module`, `Function`
- Exclude other parent kinds (e.g., `Interface`) from the path.

**Name normalization + escaping**
- For every path segment (container names and function name):
  - `segmentRaw = symbol.name.trim()`
  - `segment = encodeURIComponent(segmentRaw)`
  - This avoids ambiguity when names contain `/` or `@`.

**Selection rule ("smallest enclosing")**
- Given a position (line), collect all eligible symbols whose `range` contains the position.
- Choose the symbol with the smallest `range` length (endLine-startLine).
- Tie-breakers: deeper nesting wins; if still tied, pick the first in document order.

**functionId string format (collision-resistant for MVP)**
- `containerPath + "/" + functionName` (with URI-escaped segments)
- `anchorLine` is sent as separate metadata (1-based `selectionRange.start.line + 1`) to help the receiver pick the right symbol when multiple matches exist.
- Rationale: keeps IDs stable under line drift while preserving a deterministic disambiguation hint.
- `containerPath` is the chain of parent symbols (e.g., class name) joined by `/`.
- If no container, containerPath is empty and functionId is just `functionName`.

**Disambiguation when multiple local symbols match a functionId**
- If multiple eligible local symbols produce the same `functionId`, pick the symbol whose `selectionRange.start.line` is closest to `anchorLine` provided by the server.

### Heat Intensity Mapping (MVP)

- Server broadcasts `lastEditAt` per function (ms since epoch).
- Extension computes intensity from recency:
  - `ageMs = now - lastEditAt`
  - `intensity = clamp(1 - ageMs / decayWindowMs, 0..1)`
- Server does NOT filter by decay window (because decay is per-client setting).
- Server maintains a small recency list per function (e.g., most recent 10 distinct editors with `lastEditAt`).
- Extension filters that list using its configured decay window and displays the top 3 most recent editors that are still within-window.

Examples (TypeScript):
Examples (TypeScript):
- `function foo() {}` -> `foo` (anchorLine metadata e.g. 10)
- `class A { bar() {} }` -> `A/bar` (anchorLine metadata e.g. 42)
- `class A { constructor() {} }` -> `A/constructor` (anchorLine metadata e.g. 5)
- `function outer(){ function inner(){} }` -> `outer/inner` (anchorLine metadata e.g. 12)

**No-symbol fallback (MVP rule)**
- If no eligible symbol is found:
  - edits: do not emit `edit:push`
  - presence: emit `presence:clear`

**Edits spanning multiple functions (MVP rule)**
- For each `contentChanges[]`, compute function at:
  - start position
  - end position (if different line)
- Emit distinct `edit:push` events for each unique functionId encountered.

### "Open Tab" Subscription Detection (MVP choice)

**Goal**: subscribe to heat updates for files that are open in any tab (active or background).

**Mechanism (MVP choice: tabGroups API)**
- Use `vscode.window.tabGroups.onDidChangeTabs` to detect open/close of tabs.
- When a tab opens with a text document input, call `room:join`.
- When that tab closes (and no other tab has the same file open), call `room:leave`.

**Eligible tabs (deterministic)**
- Subscribe ONLY for `TabInputText` where `uri.scheme === "file"`.
- Ignore diff editors, SCM/git virtual documents, settings, and untitled buffers.

**De-duping rule**
- Consider two tabs the same file if their computed `{ repoId, filePath }` pair matches.
- Join the room once per unique `{ repoId, filePath }`.
- Only leave when the last tab for that `{ repoId, filePath }` closes (reference counting).

**Subscription limit (performance guardrail)**
- Maintain a max of 10 subscribed file rooms.
- When the 11th file would be subscribed, evict the least-recently-focused subscribed file (LRU) by calling `room:leave`.
- Never evict the active editor's file.

**LRU definition (deterministic)**
- A file becomes "most recently used" when it becomes the active editor via `vscode.window.onDidChangeActiveTextEditor`.
- Only subscribed rooms participate in the LRU.
- On reconnect, re-join rooms in MRU order, capped to 10 (active editor first).

**Initial MRU ordering when many tabs are open**
- On activation/reconnect, set MRU as:
  1) active editor file (if eligible)
  2) remaining eligible open tabs in current tabGroups order
- Then apply the 10-room cap by evicting oldest from the tail.

**Presence emission remains active-editor-only**
- Presence is emitted only for `vscode.window.activeTextEditor` via selection-change events.

### Presence TTL (Concrete Rule)

- Default TTL: 15 seconds (shared constant in `packages/protocol`).
- Refresh: only `presence:set` refreshes TTL for a (repoId,filePath,userId) presence entry.
- Cleanup: server runs a timer every 5 seconds to evict expired presence.
- Disconnect behavior: remove user presence immediately on socket disconnect and emit a delta.

**Multi-socket behavior per userId (deterministic)**
- Server tracks presence per socket, then reduces to per userId:
  - if the same `userId` connects multiple times, keep the max `lastSeenAt` across its active sockets
  - only remove a user from presence when all sockets for that userId have disconnected or expired

**Presence keepalive (prevents TTL flicker)**
- While the active editor is focused and the cursor remains inside the same function:
  - extension re-sends `presence:set` every 5 seconds
- When the cursor leaves all functions or editor loses focus:
  - extension sends `presence:clear` (best-effort)

**Presence clearing on editor transitions (no ghost presence)**
- On `vscode.window.onDidChangeActiveTextEditor`:
  - if the previous active editor had an active presence, immediately send `presence:clear` for the previous `{repoId,filePath}` before setting presence for the new editor.
- On window focus loss (if available) or when there is no active editor:
  - send `presence:clear` for the last active `{repoId,filePath}`.

### Dependencies + Version Rules (MVP)

- Node version (server): 24.x LTS.
- Node version (extension runtime): provided by VS Code; do not assume Node 24 inside VS Code.
- Socket.IO:
  - `socket.io` (server) and `socket.io-client` (tests/extension) MUST be the same major version.
- UUID:
  - Use `crypto.randomUUID()` (no added dependency) to generate the persistent `userId`.

### SQLite Event Store (Concrete Choice + Schema)

**Driver (MVP choice)**
- Use `better-sqlite3` for a small synchronous API (simpler than callback-based drivers).

**Schema (MVP)**
- File path: `LINEHEAT_DB_PATH` (default `/data/lineheat.sqlite`)
- Table: `events`
  - `id INTEGER PRIMARY KEY`
  - `serverTs INTEGER NOT NULL`
  - `repoId TEXT NOT NULL`
  - `filePath TEXT NOT NULL`
  - `functionId TEXT NOT NULL`
  - `anchorLine INTEGER NOT NULL`
  - `userId TEXT NOT NULL`
  - `displayName TEXT NOT NULL`
  - `emoji TEXT NOT NULL`
- Indexes:
  - `CREATE INDEX idx_events_room_ts ON events(repoId, filePath, serverTs)`
  - `CREATE INDEX idx_events_ts ON events(serverTs)`

**Retention implementation**
- `DELETE FROM events WHERE serverTs < cutoffTs`

**Cleanup cadence (deterministic)**
- Run retention cleanup:
  - once on server startup
  - then every 15 minutes

**In-memory pruning on retention**
- When retention cleanup runs, prune in-memory heat state:
  - drop any function entries whose `lastEditAt < cutoffTs`
  - prune each function's `topEditors` list to only editors with `lastEditAt >= cutoffTs`
  - after pruning, next `room:snapshot` must not include pruned functions

**Replay implementation**
- `SELECT * FROM events WHERE serverTs >= cutoffTs ORDER BY serverTs ASC`
- Reduce into in-memory heat state on startup.

### Server Scaffolding Decisions (MVP)

- Module format: ESM (`"type": "module"` in `packages/server/package.json`).
- Dev runner: `tsx` (devDependency) to run `src/index.ts` without a build step.
- Build: `tsc` to `dist/`, run via `node dist/index.js`.
- DI: manual composition root (no DI container library).
- Framework stance: no NestJS for MVP; plain Node HTTP + Socket.IO.

### SQLite Migrations (MVP)

- Use "schema-on-start" with an explicit migration step:
  - `CREATE TABLE IF NOT EXISTS ...`
  - `PRAGMA user_version` to track schema version
  - If `user_version` is behind, apply incremental SQL migrations in code.

### Socket Lifecycle Semantics (Extension)

- Connect on extension activation if settings `serverUrl` + `token` are present.
- Maintain an in-memory set of joined rooms (derived from currently-open tabs).
- On reconnect:
  - re-emit `room:join` for each currently-open file room
  - do not attempt offline replay; best-effort only
- On settings change (URL/token/displayName/emoji):
  - disconnect and reconnect with new handshake auth
  - clear local presence state; rely on server disconnect cleanup

### Extension Settings Contract (MVP)

All settings are under `lineheat.*`.

- `lineheat.serverUrl` (string, default "")
  - REQUIRED to connect
- `lineheat.token` (string, default "")
  - REQUIRED to connect
- `lineheat.displayName` (string, default `<os username>`)
  - REQUIRED in handshake; must be non-empty after trimming
- `lineheat.emoji` (string, default "🙂")
  - REQUIRED in handshake
- `lineheat.heatDecayHours` (number, default 24)
- `lineheat.logLevel` (enum: `error|warn|info|debug`, default `info`)

**Disabled state behavior (no disruption)**
- If `serverUrl` or `token` is missing/empty:
  - do not connect
  - show status bar `LineHeat: Off`
  - log one info line explaining which setting is missing
- Do not show popups on startup.
- If user explicitly runs a LineHeat command while disabled, show a single prompt with "Open Settings".
- If git remote/root detection fails for the active file:
  - do not subscribe/emit for that file
  - status bar shows `LineHeat: No git`
  - log one info line per session (no spam)

### Identity Persistence (Extension)

- Persist `userId` in `ExtensionContext.globalState` under key `lineheat.userId`.
- Generate it once via `crypto.randomUUID()` when missing.

### Rendering Spec (Minimum, Deterministic)

- Decoration anchor line: `DocumentSymbol.selectionRange.start.line` (function signature).
Tooltip content (minimum fields):
  - function label derived from `functionId`
  - "Last edit: <relative time>"
  - "Editors: 😀 name1, 🔥 name2, ..." (top 3; filtered by client decay window)
  - "Retention: <serverRetentionDays>d" (from `server:hello`)

**Presence rendering (minimum, deterministic)**
- Render presence as an "after" decoration on the same anchor line:
  - show up to 3 users inline: `<emoji> <displayName>`
  - if more than 3, append `+N`
- Full list shown in hover tooltip.

**Heat + presence composition**
- Heat uses a background decoration (color intensity from heat mapping).
- Presence uses an after-text decoration.
- Both may apply simultaneously.

**Heat color mapping (minimum default)**
- Base color: warm amber `#ffb020`.
- Background alpha: `alpha = 0.05 + 0.25 * intensity` (clamped to 0..0.3).

**Unmappable functionIds (deterministic)**
- If the extension cannot find a local eligible symbol matching a server functionId:
  - do not render heat/presence for that functionId
  - log one debug line (rate-limited)

### IDE Performance + Failure Isolation (MVP Non-Negotiables)

- Never block VS Code UI thread:
  - all network, git, and symbol computations run async
  - debounce/throttle symbol queries and presence updates
  - hard timeouts for git commands; failures disable features gracefully
- Failure-safe behavior:
  - if server is down / protocol incompatible / errors occur, editing must be unaffected
  - extension should degrade to "disabled" state without throwing unhandled exceptions
- Debug logging best practice:
  - use a dedicated log output channel (VS Code `LogOutputChannel`) with a configurable log level
  - document how to open the logs in README

---

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (extension tests via `vscode-test` in `packages/vscode-extension`)
- **Server tests**: add Vitest to `packages/server` (unit + e2e)

### Manual QA (always required)
- Run server in Docker.
- Run VS Code extension in Extension Development Host.
- Verify real multi-client behavior with two VS Code instances.

### Manual QA Runbook (Deterministic)

1) Start server (local)
- Terminal:
  - `export LINEHEAT_TOKEN=devtoken`
  - `npm install`
  - `npm run dev -w @line-heat/server`

2) Start VS Code extension host A
- Open workspace: `packages/vscode-extension`
- Run: `F5` (Extension Development Host)
- In the Extension Development Host settings, set:
  - `lineheat.serverUrl = http://localhost:8787`
  - `lineheat.token = devtoken`
  - `lineheat.displayName = Alice`
  - `lineheat.emoji = 😀`
  - `lineheat.logLevel = debug`

3) Start VS Code extension host B (repeat)
- `lineheat.displayName = Bob`, `lineheat.emoji = 🔥`

4) In BOTH hosts
- Open the same git-backed TypeScript repo and the same file.
- Expected log sequence (approx):
  - `lineheat: connected`
  - `lineheat: server:hello ... retentionDays=...`
  - `lineheat: room:join ...`
  - `lineheat: room:snapshot ...`

5) Verify behavior
- Move cursor into function A in host A:
  - host B shows presence after-decoration for Alice on function A anchor line.
- Type inside function A in host A:
  - host B shows heat intensity change + top editors.
- Open >10 distinct file tabs in host A:
  - observe `room:evict` logs and ensure oldest subscription is left.

---

## Task Flow

1) Define shared domain/event contract → 2) Server (Socket.IO + SQLite + in-memory state) → 3) Extension event emission → 4) Extension rendering → 5) Docs + hardening

---

## TODOs

> Each task includes acceptance criteria with concrete commands and/or manual verification.

### 0. Confirm baseline commands and workspace layout

**What to do**:
- Confirm workspace structure and existing scripts for the VS Code extension.
- Add root-level scripts so running build/test is straightforward.

**References**:
- `package.json` - npm workspaces root
- `packages/vscode-extension/package.json` - existing scripts (`compile`, `lint`, `test`)

**Acceptance Criteria**:
- `npm test -w vscode-extension` runs.
- Root `package.json` includes scripts:
  - `test`: runs `npm test -w @line-heat/server && npm test -w vscode-extension`
  - `build`: runs `npm run build -w @line-heat/protocol && npm run build -w @line-heat/server && npm run compile -w vscode-extension`

---

### 0.1 Add `packages/protocol` workspace (contract as code)

**What to do**:
- Create a new workspace package `packages/protocol` exporting:
  - Socket.IO event name constants
  - payload TypeScript types
  - shared defaults (presence TTL 15s, default retention 7d, max lengths)
- Ensure both server and extension depend on this package via workspace linking.

**Must NOT do**:
- Do not add runtime dependencies beyond what is required for TypeScript compilation.

**References**:
- `package.json` - workspaces root (`packages/*`)
- `.sisyphus/plans/lineheat-mvp.md` - "Contract As Code" section

**Acceptance Criteria**:
- `npm run build -w @line-heat/protocol` succeeds.
- Build artifacts exist:
  - `packages/protocol/dist/esm/index.js`
  - `packages/protocol/dist/cjs/index.js`
  - `packages/protocol/dist/cjs/package.json` (type commonjs)
  - `packages/protocol/dist/types/index.d.ts`
- Both `packages/server` and `packages/vscode-extension` compile while importing types/constants from `@line-heat/protocol`.

---

### 1. Define event contract + identifiers (domain-first)

**What to do**:
- Implement the "MVP Technical Spec" above as the single source of truth for:
  - Socket.IO event names + payloads
  - repoId derivation + normalization
  - functionId algorithm
  - tab subscription detection

**Must NOT do**:
- Do not include code content, diffs, or line text.

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - authoritative MVP spec (docs updated later)
- `packages/vscode-extension/src/extension.ts` - current edit capture event source

**Acceptance Criteria**:
- Create `packages/server/README.md` (file does not exist yet) containing the protocol tables + algorithms from "MVP Technical Spec".

---

### 2. Server skeleton (Node+TS) with hexagonal structure

**What to do**:
- Create `packages/server` project scaffolding:
  - TypeScript config
  - minimal build/run scripts
  - manual DI composition root (no DI container)
  - ESM + `tsx` dev runner per "Server Scaffolding Decisions"
- Establish ports/adapters layout:
  - domain (entities, reducers)
  - application services
  - adapters: Socket.IO transport, SQLite event store

**References**:
- `packages/server/package.json` - existing placeholder
- `packages/server/src/.gitkeep` - server src directory
- `packages/server/test/.gitkeep` - server test directory

**Acceptance Criteria**:
- `npm install` (repo root) completes.
- `npm run build -w @line-heat/server` succeeds.
- `npm run dev -w @line-heat/server` starts the server locally on a documented port (default 8787).

---

### 2.1 Server test harness setup (Vitest)

**What to do**:
- Add Vitest to `packages/server` and make `npm test -w @line-heat/server` work.
- Add a minimal e2e harness using `socket.io-client`.

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - "Server Scaffolding Decisions" and "Socket.IO Wire Protocol" sections
- `packages/server/test/.gitkeep` - server test folder

**Acceptance Criteria**:
- `npm test -w @line-heat/server` runs and reports at least one passing test.

---

### 3. Server event store (SQLite) + retention cleanup

**What to do**:
- Implement SQLite event log per "SQLite Event Store" spec (driver + schema + indexes).
- Implement retention cleanup:
  - default 7 days; configurable via env var
  - scheduled cleanup job or run-on-start + periodic
- Keep computed heat and presence in memory:
  - on startup: replay retained events to rebuild in-memory heat state
  - presence never persisted (TTL only)

**Must NOT do**:
- Do not build an admin UI or remote DB access.

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - "SQLite Event Store" section
- `packages/server/src/.gitkeep` - location where SQLite adapter will live

**Acceptance Criteria (tests)**:
- Unit tests prove:
  - events older than retention are deleted
  - replay reproduces expected in-memory heat

**Acceptance Criteria (command)**:
- `npm test -w @line-heat/server` passes.

**Manual Verification**:
- Run server, generate events, restart server, confirm heat rebuilds from retained events.

---

### 4. Server realtime rooms + auth (Socket.IO)

**What to do**:
- Require a shared token at connection time (reject if missing/invalid).
- Define rooms per (repoId, filePath) and broadcast updates only within that room.
- Add presence TTL:
  - when no heartbeat/presence updates from a user, remove presence after TTL

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - authoritative MVP spec (docs updated later)

**Acceptance Criteria (tests)**:
- E2E tests prove:
  - invalid token rejected
  - two clients in same room receive broadcasts
  - clients in different files do not receive each other's events
  - `presence:clear` removes the user from presence list within one delta emission

**Acceptance Criteria (command)**:
- `npm test -w @line-heat/server` passes.

---

### 5. In-memory heat model + broadcast format

**What to do**:
- Define in-memory state per (repoId, filePath, functionId):
  - last edit timestamp
  - topEditors list: max 10 distinct editors (by server timestamp), sent to clients; extension displays top 3 after filtering by its decay setting
- Emit update payloads that are cheap:
  - prefer deltas per function, plus occasional full snapshot
- Throttle broadcasts to avoid spamming (coalesce updates).

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - "Socket.IO Wire Protocol", "Heat Intensity Mapping", and "In-memory pruning on retention" sections

**Acceptance Criteria**:
- E2E test asserts a client receives `file:delta` after `edit:push` (coalesced, within a reasonable timeout like 1000ms).

**Acceptance Criteria (command)**:
- `npm test -w @line-heat/server` passes.

---

### 6. VS Code extension: config + identity

**What to do**:
- Add settings for:
  - server URL
  - required team token
  - display name + emoji avatar
  - heat decay window (default 24h)
  - log level
- Generate and persist `userId` (UUID) once.
  - store in `ExtensionContext.globalState` key `lineheat.userId`
- Display server-reported `serverRetentionDays` from `server:hello` in the extension UI/settings.
- Use a fallback default (7 days) only when disconnected / no `server:hello` received.

**References**:
- `packages/vscode-extension/package.json` - extension manifest
- `packages/vscode-extension/src/extension.ts` - current event listener location

**Acceptance Criteria**:
- Extension can connect to server using URL+token.
- OutputChannel (debug) includes a line like `lineheat: connected`.
- OutputChannel (debug) includes a line like `lineheat: retentionDays=<N>` after first `server:hello`.
- When server emits `server:incompatible`, the extension shows a visible prompt telling the user to update.
- Status bar shows a small indicator including the retention, e.g. `LineHeat: 7d` (exact text can vary).
- If settings are missing, status bar shows `LineHeat: Off` and no connection attempts are made.

---

### 7. VS Code extension: derive repoId + git-root-relative paths

**What to do**:
- Resolve git remote for the current file's repo root (prefer `origin`; normalize URL).
- Convert file path to git-root-relative path for room keying.
- Define fallback behavior (no git remote): show disabled state and do not emit events.

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - "repoId Derivation" and "Rooms" sections
- `packages/vscode-extension/src/extension.ts` - current event entrypoints

**Acceptance Criteria**:
- Extension logs (to OutputChannel in dev) the computed `{ repoId, filePath }` when joining a room.
- Two VS Code instances on different machines, same repo + same file:
  - show identical `repoId`
  - show identical `filePath` (git-root-relative)
- If `git`/remote is missing, extension shows a disabled state and does not emit.

---

### 8. VS Code extension: function identification (symbols)

**What to do**:
- Use document symbols to find the smallest enclosing function/method symbol for:
  - edit locations (from change ranges)
  - cursor location (active editor selection)
- Create deterministic `functionId` per "functionId Algorithm" in the spec (stable id) and compute `anchorLine` metadata.
- Cache symbols per document and refresh on debounced schedule.

**References**:
- `packages/vscode-extension/src/extension.ts` - current change events

**Acceptance Criteria**:
- OutputChannel (debug) logs `lineheat: edit functionId=<...>` and `lineheat: presence functionId=<...>`.
- Editing inside a function consistently maps to the same functionId while the document is open.

---

### 9. VS Code extension: emit edit + presence events

**What to do**:
- On edit event: emit `EditEvent` with `{ functionId, anchorLine }` for the touched function(s).
- On cursor move/selection change (active editor only): emit `PresenceEvent` with `{ functionId, anchorLine }` when inside a function; emit "no presence" when leaving.
- Implement presence keepalive per spec (re-send `presence:set` every 5s while cursor stays inside same function).
- Throttle presence emission to avoid chatter.

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - "Client -> Server events" and "Presence TTL" sections

**Acceptance Criteria**:
- With server running and extension connected, OutputChannel (debug) shows:
  - `lineheat: presence:set` when cursor enters a function
  - `lineheat: presence:clear` when cursor leaves all functions
  - `lineheat: presence:set` repeats at least once every ~5s while cursor stays inside the same function (keepalive)

---

### 10. VS Code extension: subscribe/unsubscribe to file rooms

**What to do**:
- Track open documents/tabs and join rooms for files that are open (including background tabs), up to the max subscription limit (10).
- When the 11th file would be subscribed, evict the least-recently-focused subscribed file (LRU) and leave its room.
- Leave rooms when a file is closed.

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - "Open Tab Subscription Detection" section

**Acceptance Criteria**:
- In a single VS Code instance, opening a file tab logs `lineheat: room:join repoId=<...> filePath=<...>`.
- Closing the last tab for that file logs `lineheat: room:leave ...`.
- Opening 11th distinct file causes a log like `lineheat: room:evict filePath=<...>` and the evicted file stops receiving updates.
- Two users with the same file open see heat/presence updates; closing the file stops receiving updates.

---

### 11. VS Code extension: render heat + presence

**What to do**:
- Render function-level heat by recency:
  - decorate the function signature line (or another stable anchor) with intensity based on time since last edit
  - decay parameters controlled by setting (default 24h)
- Render presence:
  - show name+emoji for users currently present in the same function
- Render attribution:
  - show top 3 most recent editors per function (e.g., hover tooltip or inline hint)

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - "Rendering Spec" and "Heat Intensity Mapping" sections

**Acceptance Criteria (manual)**:
- With two VS Code instances:
  - editing in a function makes it "hot" on both
  - moving cursor changes presence shown
  - after inactivity, heat visibly fades
  - hovering the decorated function line shows a tooltip including:
    - lastEditAt age (or timestamp)
    - the top editors (up to 3, emoji + name)
    - full presence list (ordered, with `+N` if more than 3 inline)

---

### 12. Extension performance + observability hardening

**What to do**:
- Ensure all expensive work is async and throttled:
  - git commands via async process exec with timeouts
  - symbol queries debounced
  - network reconnect/join work done off the UI thread
- Ensure failures never impact editing:
  - wrap all event handlers in try/catch
  - do not throw from activation/event callbacks
  - degrade to disabled state when server/protocol/git/symbols fail
- Implement industry-standard logs:
  - use a `LogOutputChannel` (so logs appear under VS Code's Logs UI)
  - add a `lineheat.logLevel` setting
- document how to open logs

**References**:
- `.sisyphus/plans/lineheat-mvp.md` - "IDE Performance + Failure Isolation" section

**Acceptance Criteria (manual)**:
- With server URL unreachable, typing/editing in a large TypeScript file shows:
  - no unhandled error notifications
  - no repeated popups (at most one prompt per session for explicit user actions)
- Using VS Code's "Developer: Open Extension Host Profile" for ~10s of typical editing shows no sustained long tasks attributable to LineHeat.
- Logs are accessible via the VS Code "Logs" UI and include:
  - connection attempts + failures
  - join/leave + evictions
  - protocol incompatibility message

**Acceptance Criteria (objective checks)**
- Symbol queries are debounced to at least 250ms (log one debug line indicating debounce when logLevel=debug).
- Presence keepalive emits at most once per 5 seconds (log shows cadence when logLevel=debug).

---

### 13. Tests (TDD) for server domain + e2e

**What to do**:
- Expand server test coverage (Vitest is already set up in Task 2.1):
  - unit tests for reducers (heat + ordering + distinctness rules)
  - unit tests for retention deletion + in-memory pruning
  - e2e tests using socket.io-client (auth + room isolation + broadcast + protocol incompat)

**References**:
- `packages/server/test/.gitkeep` - where tests go

**Acceptance Criteria**:
- `npm test -w @line-heat/server` passes.

---

### 14. Update extension tests for new behavior

**What to do**:
- Update existing extension tests to align with new event emission (keep internal logger if helpful for tests).
- Add at least one test exercising symbol-to-function mapping on a TS fixture file.

**References**:
- `packages/vscode-extension/src/__tests__/extension.test.ts` - current tests

**Acceptance Criteria**:
- `npm test -w vscode-extension` passes.

---

### 15. Docker + docs (privacy + debugging)

**What to do**:
- Add `packages/server/Dockerfile` (file does not exist yet) and README instructions:
  - Base image: `node:24-bookworm-slim` (avoid Alpine friction with native addons)
  - Install build deps for `better-sqlite3`: `python3 make g++`
  - Server must listen on `0.0.0.0:${PORT}` for container compatibility
  - run server with token + retention env vars
  - volume mount for SQLite file
  - how to `docker exec` and inspect SQLite with `sqlite3`
- Update root `README.md` and extension README:
  - explicitly mention: no global view; no content shared; retention default 1 week; extension shows retention
  - explicitly mention: identity (name/emoji) is only visible to others who also have the same file open
  - update wording that currently implies "anonymous" signals to align with MVP requirements

**References**:
- `README.md` - primary product narrative + privacy section
- `packages/vscode-extension/README.md` - extension usage docs

**Acceptance Criteria**:
- Docs include copy-pastable commands:
  - `npm run dev -w @line-heat/server`
  - `npm test -w @line-heat/server`
  - `npm test -w vscode-extension`
  - `docker build -t lineheat-server -f packages/server/Dockerfile .`
  - `docker run -e LINEHEAT_TOKEN=... -e LINEHEAT_RETENTION_DAYS=7 -v $PWD/.lineheat:/data -p 8787:8787 lineheat-server`
  - `docker exec -it <container> sqlite3 /data/lineheat.sqlite '.tables'`

---

## Commit Strategy

- Keep commits small and scoped (server skeleton, then server storage, then extension emission, then extension rendering, then docs/tests).

---

## Success Criteria

- Self-hostable Docker deployment exists for server.
- VS Code-only MVP demonstrates the coordination value (who is editing what function recently + live presence) without a global surveillance view.
- Retention is enforced and clearly communicated.
- Automated tests cover core domain logic and basic realtime flows.
