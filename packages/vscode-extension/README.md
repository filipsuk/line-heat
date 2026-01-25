# LineHeat (VS Code Extension)

LineHeat overlays a decaying heatmap on code based on recent teammate activity (MVP).

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
