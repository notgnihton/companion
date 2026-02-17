import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("default values", () => {
    it("should use default PORT when not provided", async () => {
      delete process.env.PORT;
      const { config } = await import("./config.js");
      expect(config.PORT).toBe(8787);
    });

    it("should use default AXIS_TIMEZONE when not provided", async () => {
      delete process.env.AXIS_TIMEZONE;
      const { config } = await import("./config.js");
      expect(config.AXIS_TIMEZONE).toBe("America/New_York");
    });

    it("should use default AXIS_USER_NAME when not provided", async () => {
      delete process.env.AXIS_USER_NAME;
      const { config } = await import("./config.js");
      expect(config.AXIS_USER_NAME).toBe("friend");
    });

    it("should use default AXIS_FALLBACK_EMAIL when not provided", async () => {
      delete process.env.AXIS_FALLBACK_EMAIL;
      const { config } = await import("./config.js");
      expect(config.AXIS_FALLBACK_EMAIL).toBe("user@example.com");
    });

    it("should use default AXIS_VAPID_SUBJECT when not provided", async () => {
      delete process.env.AXIS_VAPID_SUBJECT;
      const { config } = await import("./config.js");
      expect(config.AXIS_VAPID_SUBJECT).toBe("mailto:companion@example.com");
    });

    it("should use default integration date window values", async () => {
      delete process.env.INTEGRATION_WINDOW_PAST_DAYS;
      delete process.env.INTEGRATION_WINDOW_FUTURE_DAYS;
      const { config } = await import("./config.js");
      expect(config.INTEGRATION_WINDOW_PAST_DAYS).toBe(30);
      expect(config.INTEGRATION_WINDOW_FUTURE_DAYS).toBe(180);
    });
  });

  describe("custom values", () => {
    it("should parse PORT from environment", async () => {
      process.env.PORT = "3000";
      const { config } = await import("./config.js");
      expect(config.PORT).toBe(3000);
    });

    it("should parse AXIS_TIMEZONE from environment", async () => {
      process.env.AXIS_TIMEZONE = "Europe/London";
      const { config } = await import("./config.js");
      expect(config.AXIS_TIMEZONE).toBe("Europe/London");
    });

    it("should parse AXIS_USER_NAME from environment", async () => {
      process.env.AXIS_USER_NAME = "Alice";
      const { config } = await import("./config.js");
      expect(config.AXIS_USER_NAME).toBe("Alice");
    });

    it("should handle all custom values at once", async () => {
      process.env.PORT = "5000";
      process.env.AXIS_TIMEZONE = "Asia/Tokyo";
      process.env.AXIS_USER_NAME = "Bob";
      process.env.AXIS_VAPID_PUBLIC_KEY = "public-key";
      process.env.AXIS_VAPID_PRIVATE_KEY = "private-key";
      process.env.AXIS_VAPID_SUBJECT = "mailto:bob@example.com";
      process.env.AXIS_FALLBACK_EMAIL = "bob@example.com";
      process.env.INTEGRATION_WINDOW_PAST_DAYS = "14";
      process.env.INTEGRATION_WINDOW_FUTURE_DAYS = "120";

      const { config } = await import("./config.js");

      expect(config.PORT).toBe(5000);
      expect(config.AXIS_TIMEZONE).toBe("Asia/Tokyo");
      expect(config.AXIS_USER_NAME).toBe("Bob");
      expect(config.AXIS_VAPID_PUBLIC_KEY).toBe("public-key");
      expect(config.AXIS_VAPID_PRIVATE_KEY).toBe("private-key");
      expect(config.AXIS_VAPID_SUBJECT).toBe("mailto:bob@example.com");
      expect(config.AXIS_FALLBACK_EMAIL).toBe("bob@example.com");
      expect(config.INTEGRATION_WINDOW_PAST_DAYS).toBe(14);
      expect(config.INTEGRATION_WINDOW_FUTURE_DAYS).toBe(120);
    });
  });

  describe("type coercion", () => {
    it("should coerce string PORT to number", async () => {
      process.env.PORT = "9999";
      const { config } = await import("./config.js");
      expect(typeof config.PORT).toBe("number");
      expect(config.PORT).toBe(9999);
    });

    it("should handle numeric string with leading zeros", async () => {
      process.env.PORT = "08080";
      const { config } = await import("./config.js");
      expect(config.PORT).toBe(8080);
    });
  });

  describe("validation", () => {
    it("should handle invalid PORT gracefully", async () => {
      process.env.PORT = "not-a-number";
      await expect(async () => {
        await import("./config.js");
      }).rejects.toThrow();
    });

    it("should accept empty string for AXIS_TIMEZONE", async () => {
      process.env.AXIS_TIMEZONE = "";
      const { config } = await import("./config.js");
      expect(config.AXIS_TIMEZONE).toBe("");
    });

    it("should accept empty string for AXIS_USER_NAME", async () => {
      process.env.AXIS_USER_NAME = "";
      const { config } = await import("./config.js");
      expect(config.AXIS_USER_NAME).toBe("");
    });
  });
});
