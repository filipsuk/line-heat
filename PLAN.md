# LineHeat Plan (Lean)

## Goal
Create an IDE plugin system that shows live line-level activity across a team, starting with VS Code and a minimal backend server.

## High-Level Architecture (TODOs)
- Decide overall stack for server and plugins (languages, frameworks, hosting).
- Define client-server sync model (push vs pull, protocols, auth).
- Define data flow for line activity signals (capture, aggregate, transmit, decay).
- Define privacy boundaries and metadata limits (no content sharing).
- Define invite-first following rules (users can follow only after being invited).
- Consider an MCP server so agents can check activity and send signals/info.

## Data Model (TODOs)
- Define core entities (activity signal, file identifier, line range, timestamp).
- Decide identifier strategy (hashing, file paths, workspace IDs).
- Define retention and decay policies for signals.
- Add invite relationship metadata and lifecycle (invite, accept, revoke).

## Backend App (Server) (TODOs)
- Decide transport layer (websocket, SSE, HTTP polling).
- Define minimal API surface for sync and presence.
- Decide storage approach (in-memory vs lightweight persistence).
- Define scalability requirements (single-dev target, minimal ops).

## Frontend Apps (IDE Plugins) (TODOs)
- VS Code first: decide extension architecture and data capture strategy.
- Define UI rendering approach for line heat overlays.
- Define local buffering and throttling behavior.

## Testing Strategy (TODOs)
- Decide unit/integration strategy for server and domain logic.
- Define e2e approach for VS Code extension (recommended tooling).
- Define minimal test harness for client-server sync flows.

## Initial Milestones (TODOs)
- Spike VS Code extension: capture line edits locally.
- Spike server: accept and broadcast activity signals.
- Prototype heat overlay: render local signals with decay.
