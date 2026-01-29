import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "@line-heat/protocol";

describe("protocol version", () => {
  it("matches the MVP version", () => {
    expect(PROTOCOL_VERSION).toBe("2.0.0");
  });
});
