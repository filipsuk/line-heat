#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 0.3.0

version="${1:-}"
if [ -z "$version" ]; then
  echo "Usage: $0 <version>" >&2
  echo "Example: $0 0.3.0" >&2
  exit 1
fi

if ! echo "$version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: version must be in X.Y.Z format (e.g. 0.3.0)" >&2
  exit 1
fi

# Determine pre-release vs stable from minor version (odd = pre-release, even = stable)
minor=$(echo "$version" | cut -d. -f2)
if (( minor % 2 == 1 )); then
  tag="v${version}-pre"
  channel="pre-release"
else
  tag="v${version}"
  channel="stable"
fi

# Run from repo root
cd "$(git rev-parse --show-toplevel)"

echo "Preparing ${channel} release ${version} (tag: ${tag})"

npm version "$version" -w lineheat-vscode --no-git-tag-version
git add packages/vscode-extension/package.json package-lock.json
git commit -m "chore: bump version to ${version}"
git tag "$tag"

echo ""
echo "Done. Release commit and tag '${tag}' created locally."
echo "Push when ready:"
echo "  git push origin main --tags"
