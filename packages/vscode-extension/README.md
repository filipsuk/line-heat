# LineHeat

**LineHeat** visualizes **live code activity** across your team to prevent conflicts even before you commit.

It answers a simple question in real time:

> *"Is someone else working here right now?"*

Unlike Git history, pull requests, or blame views, LineHeat focuses on **what is happening now**, not what already happened.

## What LineHeat Shows

- Live activity intensity on individual **parts of code**
- Recent edits by teammates, cooling over time
- **Explorer decorations** on files and folders with recent teammate activity
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
- Reducing redundant effort during refactors

## Configuration

1. **Install the extension** from the VS Code Marketplace
2. **Configure the extension** in VS Code settings:
   - `lineheat.token` (required) - shared team token (must match server `LINEHEAT_TOKEN`)
   - `lineheat.displayName` (required) - shown to teammates
   - `lineheat.emoji` (optional) - shown next to your name (default: 🙂)
   - `lineheat.heatDecayHours` (optional) - hours before heat fully decays (default: `72`)
   - `lineheat.explorerDecorations` (optional) - show heat decorations on files/folders in the Explorer (default: `true`)
   - `lineheat.logLevel` (optional) - `error|warn|info|debug` (default: `info`)
   - `lineheat.serverUrl` (required) - use default host or your LineHeat server URL

When connected, the status bar shows the server retention (example: `LineHeat: 7d`).

## Explorer Decorations

When enabled, LineHeat marks files and folders in the Explorer that have recent teammate activity:

- **Files** show a fire emoji badge with a tooltip indicating how long ago the edit was (e.g. "Teammates edited 5m ago")
- **Folders** show a subtle dot badge when they contain hot files, with the tooltip showing the most recent edit time

This gives you an at-a-glance view of where your team is working without opening any files. Disable with `lineheat.explorerDecorations: false`.

## Privacy

LineHeat is **not a surveillance tool**.

- **No source code, keystrokes, or file contents are transmitted**
- `repoId`, `filePath`, and `functionId` are sent/stored as SHA-256 hashes (64-char lowercase hex). Raw filenames/paths and symbol names do not leave your machine
- Hashes are unsalted + deterministic (stable across sessions) which means common paths/names may be guessable
- **Non-anonymity note:** `userId` + `displayName` + `emoji` are shared to teammates in the same file room (i.e. teammates who also have the same file open)
- Retention defaults to 7 days (configurable on server)

If you are not looking at a file, LineHeat shows you nothing about it.

## Repository Filtering

You can limit LineHeat to specific repositories using glob patterns:

```json
"lineheat.enabledRepositories": ["/home/user/work/*", "**/company-*"]
```

By default (empty array), LineHeat is enabled for all repositories. Use the command **"LineHeat: Enable for this repository"** to quickly add the current repository.

## Troubleshooting

- Open the **Output panel** and select the **LineHeat** log channel
- Set `lineheat.logLevel` to `debug` for verbose protocol + room join/leave logs

## Status

🚧 **Early development / experimental**

APIs, behavior, and UI are expected to change.

## License

MIT
