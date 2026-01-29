import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("Logger", () => {
  const originalEnv = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.LOG_LEVEL = originalEnv;
  });

  describe("with default environment", () => {
    let logger: any;

    beforeEach(async () => {
      vi.resetModules();
      delete process.env.LOG_LEVEL;
      
      const loggerModule = await import("../../src/adapters/logger.js");
      logger = loggerModule.logger;
    });

    it("logs info messages by default", () => {
      logger.info("test info");
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("[INFO] test info")
      );
    });

    it("does not log debug messages by default", () => {
      logger.debug("test debug");
      expect(console.debug).not.toHaveBeenCalled();
    });

    it("logs warning messages", () => {
      logger.warn("test warning");
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("[WARN] test warning")
      );
    });

    it("logs error messages", () => {
      logger.error("test error");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR] test error")
      );
    });

    it("includes metadata in log messages", () => {
      logger.info("test with meta", { userId: "123", action: "test" });
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('{"userId":"123","action":"test"}')
      );
    });

    it("includes timestamp in log messages", () => {
      logger.info("test timestamp");
      expect(console.info).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
      );
    });
  });
});
