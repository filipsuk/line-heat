# Releasing to VS Code Marketplace

This extension follows the [VS Code recommended versioning scheme](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):

| Channel     | Minor version    | Example version |
|-------------|------------------|-----------------|
| Pre-release | Odd (1, 3, 5...) | `0.1.0`, `0.3.0` |
| Stable      | Even (2, 4, 6...)| `0.2.0`, `0.4.0` |

## Pre-release

```bash
# 1. Update version (use odd minor number)
npm version 0.1.0 -w lineheat-vscode --no-git-tag-version

# 2. Commit
git add packages/vscode-extension/package.json
git commit -m "chore: bump version to 0.1.0"

# 3. Tag and push (tag must include -pre suffix)
git tag v0.1.0-pre
git push origin main --tags
```

The `-pre` suffix in the tag triggers `.github/workflows/publish-marketplace-prerelease.yml`.

## Stable Release

```bash
# 1. Update version (use even minor number)
npm version 0.2.0 -w lineheat-vscode --no-git-tag-version

# 2. Commit
git add packages/vscode-extension/package.json
git commit -m "chore: bump version to 0.2.0"

# 3. Tag and push (no -pre suffix)
git tag v0.2.0
git push origin main --tags
```

Tags without `-pre` trigger `.github/workflows/publish-marketplace-stable.yml`.

## Patch Releases

For patches, increment the patch number while keeping the minor version:

```bash
# Pre-release patch: 0.1.0 -> 0.1.1
npm version 0.1.1 -w lineheat-vscode --no-git-tag-version
git add packages/vscode-extension/package.json
git commit -m "chore: bump version to 0.1.1"
git tag v0.1.1-pre
git push origin main --tags

# Stable patch: 0.2.0 -> 0.2.1
npm version 0.2.1 -w lineheat-vscode --no-git-tag-version
git add packages/vscode-extension/package.json
git commit -m "chore: bump version to 0.2.1"
git tag v0.2.1
git push origin main --tags
```

## Quick Reference

| Action | Command |
|--------|---------|
| Bump version | `npm version X.Y.Z -w lineheat-vscode --no-git-tag-version` |
| Pre-release tag | `git tag vX.Y.Z-pre` |
| Stable tag | `git tag vX.Y.Z` |
| Push with tags | `git push origin main --tags` |
