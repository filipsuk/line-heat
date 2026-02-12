# Releasing

This extension follows the [VS Code recommended versioning scheme](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):

| Channel     | Minor version    | Example version |
|-------------|------------------|-----------------|
| Pre-release | Odd (1, 3, 5...) | `0.1.0`, `0.3.0` |
| Stable      | Even (2, 4, 6...)| `0.2.0`, `0.4.0` |

## How to release

**Step 1** — Create the release commit and tag:

```bash
npm run release -w lineheat-vscode -- 0.3.0
```

This bumps `package.json`, commits, and creates the correct git tag (`v0.3.0-pre` for odd minor, `v0.3.0` for even minor).

**Step 2** — Push:

```bash
git push origin main --tags
```

## What happens after push

| Tag pattern | Workflows triggered |
|-------------|---------------------|
| `v*-pre*` | `publish-marketplace-prerelease.yml` + `release-vsix.yml` |
| `v0.2.0` | `publish-marketplace-stable.yml` + `release-vsix.yml` |

Both create a GitHub release with the VSIX attached. Pre-release tags are marked as pre-release in GitHub.
