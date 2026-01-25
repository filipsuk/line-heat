export type Semver = {
  major: number;
  minor: number;
  patch: number;
};

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export const parseSemver = (input: string): Semver | null => {
  const match = SEMVER_PATTERN.exec(input.trim());
  if (!match) {
    return null;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (
    Number.isNaN(major) ||
    Number.isNaN(minor) ||
    Number.isNaN(patch)
  ) {
    return null;
  }

  return { major, minor, patch };
};

export const compareSemver = (left: Semver, right: Semver): number => {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
};
