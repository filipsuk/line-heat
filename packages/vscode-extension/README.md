# Line Heat

Line Heat logs the file path and line number every time you edit a line.

## Usage

1. Start the extension in an Extension Development Host.
2. Open the Output panel.
3. Select `Line Heat` to see logs like:

```
/absolute/path/to/file.ts:12
```

## Notes

- Only changed line numbers are logged.
- Logs are emitted once per line per edit event.

## Development Folders

- `.vscode/` holds launch/tasks/settings for developing this extension.
- `.vscode-test/` is created by the test runner and can be deleted anytime.
- `out/` contains compiled JavaScript output from TypeScript builds.
