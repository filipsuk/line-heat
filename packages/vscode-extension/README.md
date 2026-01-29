# LineHeat

**LineHeat** visualizes **live code activity** across your team by overlaying a heatmap directly on source lines.

It answers a simple question in real time:

> *"Is someone else working here right now?"*

Unlike Git history, pull requests, or blame views, LineHeat focuses on **what is happening now**, not what already happened.

## What LineHeat Shows

- Live activity intensity on individual **parts of code**
- Recent edits by teammates, cooling over time
- File-level and line-level hotspots
- Passive awareness without requiring a shared editing session

LineHeat is **not** collaborative editing. It does not move your cursor, sync your view, or force pair programming.

## Why Use LineHeat

Modern teams work in parallel, often unknowingly touching the same areas of code.

Current tools fall into two extremes:
- **Git-based tools** → historical, too late
- **Live co-editing** → intrusive, synchronous

LineHeat sits in between: asynchronous, ambient, low-friction. It provides awareness without coordination overhead.

**Use cases:**
- Avoiding overlapping work and accidental conflicts
- Understanding active ownership in large codebases
- Supporting "loosely coupled" parallel development
- Reducing redundant effort during refactors

## Configuration

1. **Install the extension** from the VS Code Marketplace
2. **Deploy the LineHeat server** (see [server documentation](https://github.com/filipsuk/line-heat))
3. **Configure the extension** in VS Code settings:
   - `lineheat.serverUrl` (required) - your LineHeat server URL
   - `lineheat.token` (required) - shared team token (must match server `LINEHEAT_TOKEN`)
   - `lineheat.displayName` (optional) - shown to teammates (default: OS username)
   - `lineheat.emoji` (optional) - shown next to your name (default: 🙂)
   - `lineheat.heatDecayHours` (optional) - hours before heat fully decays (default: `72`)
   - `lineheat.logLevel` (optional) - `error|warn|info|debug` (default: `info`)

When connected, the status bar shows the server retention (example: `LineHeat: 7d`).

## Privacy

LineHeat is **not a surveillance tool**.

- **No source code, keystrokes, or file contents are transmitted**
- `repoId`, `filePath`, and `functionId` are sent/stored as SHA-256 hashes (64-char lowercase hex). Raw filenames/paths and symbol names do not leave your machine
- Hashes are unsalted + deterministic (stable across sessions) which means common paths/names may be guessable
- **Non-anonymity note:** `userId` + `displayName` + `emoji` are shared to teammates in the same file room (i.e. teammates who also have the same file open)
- Retention defaults to 7 days (configurable on server)
- No tracking of time, productivity, or individuals

If you are not looking at a file, LineHeat shows you nothing about it.

## Troubleshooting

- Open the **Output panel** and select the **LineHeat** log channel
- Set `lineheat.logLevel` to `debug` for verbose protocol + room join/leave logs

## Status

🚧 **Early development / experimental**

APIs, behavior, and UI are expected to change.

## License

MIT
