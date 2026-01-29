import { describe, it, expect } from "vitest";
import { HASH_VERSION, sha256Hex } from "@line-heat/protocol";

describe("Hash", () => {
  it("exports correct HASH_VERSION", () => {
    expect(HASH_VERSION).toBe("sha256-hex-v1");
  });

  describe("sha256Hex", () => {
    it("hashes empty string correctly", () => {
      expect(sha256Hex("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
    });

    it("hashes 'abc' correctly", () => {
      expect(sha256Hex("abc")).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
      );
    });

    it("always returns 64-character hex string", () => {
      const result = sha256Hex("test input");
      expect(result).toMatch(/^[0-9a-f]{64}$/);
      expect(result).toHaveLength(64);
    });

    it("produces consistent results", () => {
      const input = "consistency test";
      const result1 = sha256Hex(input);
      const result2 = sha256Hex(input);
      expect(result1).toBe(result2);
    });
  });
});