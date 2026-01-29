# LineHeat

**LineHeat** is an IDE plugin that visualizes **live code activity** across your team by overlaying a heatmap directly on source lines.

It answers a simple question in real time:

> *“Is someone else working here right now?”*

Unlike Git history, pull requests, or blame views, LineHeat focuses on **what is happening now**, not what already happened.

---

## What LineHeat Shows

- Live activity intensity on individual **lines of code**
- Recent edits by teammates, fading over time
- File-level and line-level hotspots
- Passive awareness without requiring a shared editing session

LineHeat is **not** collaborative editing.  
It does not move your cursor, sync your view, or force pair programming.

---

## Why LineHeat Exists

Modern teams work in parallel, often unknowingly touching the same areas of code.

Current tools fall into two extremes:
- **Git-based tools** → historical, too late
- **Live co-editing** → intrusive, synchronous

LineHeat sits in between:
- asynchronous
- ambient
- low-friction

It provides awareness without coordination overhead.

In the AI era, parallel changes happen faster and more quietly.
LineHeat shows where people are actively working so teams avoid collisions and duplicate effort.

---

## Intended Use Cases

- Avoiding overlapping work and accidental conflicts
- Understanding active ownership in large codebases
- Supporting “loosely coupled” parallel development
- Reducing redundant effort during refactors

---

## How It Works (High Level)

1. The IDE plugin observes **local edit activity** (no keystroke logging).
2. Activity is aggregated into **line-level signals**.
3. Signals are shared with teammates via a lightweight sync layer.
4. Lines are rendered with a **decaying heat overlay**.

No file contents are shared.  
Only minimal metadata required for visualization.

---

## Privacy

LineHeat is **not a surveillance tool**.

- No global view of who is working or when
- No source code, keystrokes, or file contents shared
- No exact filenames/paths or symbol names leave your machine: the identifiers `repoId`, `filePath`, and `functionId` are transmitted/stored only as SHA-256 hashes (64-char lowercase hex)
- Hashes are unsalted + deterministic (stable across sessions) which means common paths/names may be guessable
- Retention defaults to 7 days (configurable)
- The extension shows the current retention (e.g. `LineHeat: 7d`)
- Non-anonymity note: `userId` + `displayName` + `emoji` are shared to teammates in the same file room (i.e. teammates who also have the same file open)
- No tracking of time, productivity, or individuals

If you are not looking at a file, LineHeat shows you nothing about it.

---

## Invite someone to follow you

Invite-first following keeps privacy intact: someone can follow you **only after you invite them**.  
Use this when you want a teammate to see what you are working on in real time.

---

## Non-Goals

LineHeat intentionally does **not**:
- Replace version control
- Perform code review
- Enable real-time co-editing
- Track productivity or individual activity

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

## Planned Roadmap

- [ ] VS Code plugin (first target)
- [ ] Heat decay + intensity tuning
- [ ] File-level overview
- [ ] Opt-in team sync
- [ ] Privacy and scope controls
- [ ] JetBrains IDE support

---

## License

TBD (likely permissive open-source license).
