# LineHeat (VS Code Extension)

LineHeat overlays a decaying heatmap on code based on recent teammate activity (MVP).

## Try It In VS Code

Prereqs:
- Node.js + npm
- VS Code

From repo root:

```bash
npm install --no-package-lock
```

Start the server (optional but recommended for testing the realtime features):

```bash
export LINEHEAT_TOKEN=devtoken
npm run dev -w @line-heat/server
```

Run the extension in an Extension Development Host:

1) Open `packages/vscode-extension` in VS Code
2) Run `npm run compile` (or use the default build task)
3) Press `F5` to launch the Extension Development Host
4) In the Extension Development Host settings, set:
   - `lineheat.serverUrl = http://localhost:8787`
   - `lineheat.token = devtoken`
   - `lineheat.displayName = Your Name`
   - `lineheat.emoji = 🙂`

To package a `.vsix` (optional):

```bash
cd packages/vscode-extension
npm exec --yes @vscode/vsce package -- --no-dependencies
```

Then install it in VS Code via "Extensions: Install from VSIX...".

Note: The extension bundles its runtime dependencies into `out/extension.js`, so the VSIX stays small and doesn't pull in the whole workspace.

## Configuration

Settings live under the `lineheat.*` namespace:

- `lineheat.serverUrl` (required) - LineHeat server URL (e.g. `http://localhost:8787`)
- `lineheat.token` (required) - shared team token (must match server `LINEHEAT_TOKEN`)
- `lineheat.displayName` (optional) - shown to teammates (default: `${env:USER}`)
- `lineheat.emoji` (optional) - shown next to your name (default: `U+1F642`)
- `lineheat.heatDecayHours` (optional) - hours before heat fully decays (default: `24`)
- `lineheat.logLevel` (optional) - `error|warn|info|debug` (default: `info`)

When connected, the status bar shows the server retention (example: `LineHeat: 7d`).

## Logs / Debugging

- Open the Output panel and select the `LineHeat` log channel.
- Set `lineheat.logLevel` to `debug` for verbose protocol + room join/leave logs.

## Development Folders

- `.vscode/` holds launch/tasks/settings for developing this extension.
- `.vscode-test/` is created by the test runner and can be deleted anytime.
- `out/` contains compiled JavaScript output from TypeScript builds.
