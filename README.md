# LineHeat

<p align="center">
  <img src="packages/vscode-extension/icon.svg" alt="LineHeat Logo" width="128" height="128">
</p>

**LineHeat** visualizes **live code activity** across your team to prevent conflicts even before you commit.

It answers a simple question in real time:

> *"Is someone else working here right now?"*

Unlike Git history, pull requests, or blame views, LineHeat focuses on **what is happening now**, not what already happened.

---

## What LineHeat Shows

- Live activity intensity on individual **parts of code**
- Recent edits by teammates, cooling over time
- Passive awareness without requiring a shared editing session

LineHeat is **not** collaborative editing. It does not move your cursor, sync your view, or force pair programming.

---

## Why Use LineHeat

Modern teams work in parallel, often unknowingly touching the same areas of code.

Current tools fall into two extremes:
- **Git-based tools** → historical, too late
- **Live co-editing** → intrusive, synchronous

LineHeat sits in between: asynchronous, ambient, low-friction. It provides awareness without coordination overhead.

**Use cases:**
- Avoiding overlapping work and accidental conflicts
- Reducing redundant effort during refactors

---

## Configuration

1. **Install the extension** from the VS Code Marketplace
2. **Configure the extension** in VS Code settings:
   - `lineheat.token` (required) - shared team token (must match server `LINEHEAT_TOKEN`)
   - `lineheat.displayName` (required) - shown to teammates
   - `lineheat.emoji` (optional) - shown next to your name (default: 🙂)
   - `lineheat.heatDecayHours` (optional) - hours before heat fully decays (default: `72`)
   - `lineheat.logLevel` (optional) - `error|warn|info|debug` (default: `info`)
   - `lineheat.serverUrl` (required) - use default host or your LineHeat server URL

When connected, the status bar shows the server retention (example: `LineHeat: 7d`).

---

## Privacy

LineHeat is **not a surveillance tool**.

- **No source code, keystrokes, or file contents are transmitted**
- `repoId`, `filePath`, and `functionId` are sent/stored as SHA-256 hashes (64-char lowercase hex). Raw filenames/paths and symbol names do not leave your machine
- Hashes are unsalted + deterministic (stable across sessions) which means common paths/names may be guessable
- **Non-anonymity note:** `userId` + `displayName` + `emoji` are shared to teammates in the same file room (i.e. teammates who also have the same file open)
- Retention defaults to 7 days (configurable on server)

If you are not looking at a file, LineHeat shows you nothing about it.

---

## Troubleshooting

- Open the **Output panel** and select the **LineHeat** log channel
- Set `lineheat.logLevel` to `debug` for verbose protocol + room join/leave logs

---

## Status

🚧 **Early development / experimental**

APIs, behavior, and UI are expected to change.

---

## Server (Docker)

Copy/paste:

```bash
docker build -t lineheat-server -f packages/server/Dockerfile .

docker run -e LINEHEAT_TOKEN=... -e LINEHEAT_RETENTION_DAYS=7 -e LINEHEAT_DB_PATH=/data/lineheat.sqlite -v $PWD/.lineheat:/data -p 8787:8787 lineheat-server

docker exec -it <container> sqlite3 /data/lineheat.sqlite '.tables'
```

## Releasing

VS Code Marketplace versioning follows [the recommended scheme](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):

| Channel | Minor version | Tag example | package.json version |
|---------|---------------|-------------|---------------------|
| Pre-release | Odd (1, 3, 5...) | `v0.1.0-pre` | `0.1.0` |
| Stable | Even (2, 4, 6...) | `v0.2.0` | `0.2.0` |

**Important**: The `package.json` version must always be `major.minor.patch` format (no `-pre` suffix). The `-pre` suffix is only used in git tags to trigger the pre-release workflow.

## Planned Roadmap

- [x] VS Code plugin (first target)
- [ ] JetBrains IDE support

---

## License

MIT
