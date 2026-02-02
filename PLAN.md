# LineHeat Plan (Lean)

## Goal
Create an IDE plugin system that shows live activity across a team, starting with VS Code and a minimal backend server. Initial focus is function-level heat instead of strict line-level heat to avoid conflicts across file versions.

## High-Level Architecture (Options + TODOs)
- Realtime sync: prefer WebSocket or a managed realtime layer (Supabase Realtime/Appwrite/PocketBase) that handles retries/reconnects out of the box.
- Cloud-agnostic backend: Docker-first, self-hostable services.
- Data flow: client emits metadata-only events (no content), backend appends events and reduces them into a file-level heatmap.
- Version mismatch handling: clients send file hash; show exact line presence only when hashes match.
- Privacy: capture only timestamps, file identifiers, function name, and optional line number.
- Auth: GitHub OAuth (identity only).
- Team model: MVP can be a team namespace (string slug) with auto-create on first use.

## Data Model (Options + TODOs)
- Core entities
  - File state (one row per file) storing computed heatmap by function name.
  - Append-only event log (per file) capturing change/view/presence signals.
  - Presence (TTL-based) for live avatars, keyed by file + function (+ line optional).
- Identifier strategy
  - File path + repository/workspace identifier.
  - File hash included in events to gate line-level presence.
  - Function name matching (exact) for MVP; consider AST-based IDs later.
- Retention/decay
  - Heatmap computed from latest event per function with time-decay on the client.
  - Event log can be compacted into periodic snapshots.

## Backend App (Server) (Options + TODOs)
- Transport options
  - WebSocket for realtime (primary).
  - Managed realtime layer (Supabase/Appwrite/PocketBase) to avoid custom retry logic.
- Storage options
  - Postgres for file state + event log.
  - Redis optional for presence TTL and pub/sub.
- API surface
  - Ingest events: file hash, function name, optional line, timestamp.
  - Read: file heatmap + live presence (filtered by hash for line-level detail).
  - Auth: GitHub OAuth; team namespace assignment.

## Frontend Apps (IDE Plugins) (Options + TODOs)
- VS Code first: capture function name + file hash + optional line number.
- UI rendering
  - Function-level heat overlays (primary).
  - Line-level avatars only when file hash matches.
- Client buffering
  - Batch updates; retry handled by realtime provider where possible.

## Testing Strategy (TODOs)
- Define unit/integration strategy for reducers (event log → heatmap).
- Define e2e approach for VS Code extension (recommended tooling).
- Define minimal test harness for client-server sync flows.

## Initial Milestones (TODOs)
- Spike VS Code extension: capture function name + file hash + optional line.
- Spike server: accept and store metadata events; reduce into heatmap per file.
- Prototype heat overlay: render function-level heat with time decay.
