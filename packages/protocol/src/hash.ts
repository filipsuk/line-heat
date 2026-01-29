import { createHash } from "node:crypto";

export const HASH_VERSION = "sha256-hex-v1" as const;

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}