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

    it("should use default TIMEZONE when not provided", async () => {
      delete process.env.TIMEZONE;
      delete process.env.AXIS_TIMEZONE;
      const { config } = await import("./config.js");
      expect(config.TIMEZONE).toBe("America/New_York");
    });

    it("should use default USER_NAME when not provided", async () => {
      delete process.env.USER_NAME;
      delete process.env.AXIS_USER_NAME;
      const { config } = await import("./config.js");
      expect(config.USER_NAME).toBe("friend");
    });

    it("should use default FALLBACK_EMAIL when not provided", async () => {
      delete process.env.FALLBACK_EMAIL;
      delete process.env.AXIS_FALLBACK_EMAIL;
      const { config } = await import("./config.js");
      expect(config.FALLBACK_EMAIL).toBe("user@example.com");
    });

    it("should use default VAPID_SUBJECT when not provided", async () => {
      delete process.env.VAPID_SUBJECT;
      delete process.env.AXIS_VAPID_SUBJECT;
      const { config } = await import("./config.js");
      expect(config.VAPID_SUBJECT).toBe("mailto:companion@example.com");
    });

    it("should use default integration date window values", async () => {
      delete process.env.INTEGRATION_WINDOW_PAST_DAYS;
      delete process.env.INTEGRATION_WINDOW_FUTURE_DAYS;
      const { config } = await import("./config.js");
      expect(config.INTEGRATION_WINDOW_PAST_DAYS).toBe(30);
      expect(config.INTEGRATION_WINDOW_FUTURE_DAYS).toBe(180);
    });

    it("should use default digest window hours", async () => {
      delete process.env.NOTIFICATION_DIGEST_MORNING_HOUR;
      delete process.env.NOTIFICATION_DIGEST_EVENING_HOUR;
      const { config } = await import("./config.js");
      expect(config.NOTIFICATION_DIGEST_MORNING_HOUR).toBe(8);
      expect(config.NOTIFICATION_DIGEST_EVENING_HOUR).toBe(18);
    });

    it("should default Gemini Live API settings", async () => {
      delete process.env.GEMINI_USE_LIVE_API;
      delete process.env.GEMINI_LIVE_MODEL;
      const { config } = await import("./config.js");
      expect(config.GEMINI_USE_LIVE_API).toBe(true);
      expect(config.GEMINI_LIVE_MODEL).toBe("gemini-live-2.5-flash-native-audio");
    });

    it("should default AUTH_REQUIRED to false outside production", async () => {
      delete process.env.AUTH_REQUIRED;
      process.env.NODE_ENV = "test";
      const { config } = await import("./config.js");
      expect(config.AUTH_REQUIRED).toBe(false);
    });
  });

  describe("custom values", () => {
    it("should parse PORT from environment", async () => {
      process.env.PORT = "3000";
      const { config } = await import("./config.js");
      expect(config.PORT).toBe(3000);
    });

    it("should parse TIMEZONE from environment", async () => {
      process.env.TIMEZONE = "Europe/London";
      const { config } = await import("./config.js");
      expect(config.TIMEZONE).toBe("Europe/London");
    });

    it("should parse USER_NAME from environment", async () => {
      process.env.USER_NAME = "Alice";
      const { config } = await import("./config.js");
      expect(config.USER_NAME).toBe("Alice");
    });

    it("should parse provider env vars", async () => {
      process.env.NOTES_PROVIDER = "local";
      process.env.ASSIGNMENT_PROVIDER = "manual";
      process.env.FOOD_PROVIDER = "manual";
      process.env.SOCIAL_PROVIDER = "manual";
      process.env.VIDEO_PROVIDER = "manual";

      const { config } = await import("./config.js");

      expect(config.NOTES_PROVIDER).toBe("local");
      expect(config.ASSIGNMENT_PROVIDER).toBe("manual");
      expect(config.FOOD_PROVIDER).toBe("manual");
      expect(config.SOCIAL_PROVIDER).toBe("manual");
      expect(config.VIDEO_PROVIDER).toBe("manual");
    });

    it("should parse Gemini Live API env vars", async () => {
      process.env.GEMINI_USE_LIVE_API = "false";
      process.env.GEMINI_LIVE_MODEL = "models/custom-live";
      process.env.GEMINI_LIVE_TIMEOUT_MS = "30000";

      const { config } = await import("./config.js");

      expect(config.GEMINI_USE_LIVE_API).toBe(false);
      expect(config.GEMINI_LIVE_MODEL).toBe("models/custom-live");
      expect(config.GEMINI_LIVE_TIMEOUT_MS).toBe(30000);
    });

    it("should parse auth env vars", async () => {
      process.env.AUTH_REQUIRED = "true";
      process.env.AUTH_ADMIN_EMAIL = "admin@example.com";
      process.env.AUTH_ADMIN_PASSWORD = "supersecurepassword";
      process.env.AUTH_SESSION_TTL_HOURS = "48";
      const { config } = await import("./config.js");
      expect(config.AUTH_REQUIRED).toBe(true);
      expect(config.AUTH_ADMIN_EMAIL).toBe("admin@example.com");
      expect(config.AUTH_ADMIN_PASSWORD).toBe("supersecurepassword");
      expect(config.AUTH_SESSION_TTL_HOURS).toBe(48);
    });

    it("should handle all custom values at once", async () => {
      process.env.PORT = "5000";
      process.env.TIMEZONE = "Asia/Tokyo";
      process.env.USER_NAME = "Bob";
      process.env.VAPID_PUBLIC_KEY = "public-key";
      process.env.VAPID_PRIVATE_KEY = "private-key";
      process.env.VAPID_SUBJECT = "mailto:bob@example.com";
      process.env.FALLBACK_EMAIL = "bob@example.com";
      process.env.INTEGRATION_WINDOW_PAST_DAYS = "14";
      process.env.INTEGRATION_WINDOW_FUTURE_DAYS = "120";
      process.env.NOTIFICATION_DIGEST_MORNING_HOUR = "7";
      process.env.NOTIFICATION_DIGEST_EVENING_HOUR = "19";

      const { config } = await import("./config.js");

      expect(config.PORT).toBe(5000);
      expect(config.TIMEZONE).toBe("Asia/Tokyo");
      expect(config.USER_NAME).toBe("Bob");
      expect(config.VAPID_PUBLIC_KEY).toBe("public-key");
      expect(config.VAPID_PRIVATE_KEY).toBe("private-key");
      expect(config.VAPID_SUBJECT).toBe("mailto:bob@example.com");
      expect(config.FALLBACK_EMAIL).toBe("bob@example.com");
      expect(config.INTEGRATION_WINDOW_PAST_DAYS).toBe(14);
      expect(config.INTEGRATION_WINDOW_FUTURE_DAYS).toBe(120);
      expect(config.NOTIFICATION_DIGEST_MORNING_HOUR).toBe(7);
      expect(config.NOTIFICATION_DIGEST_EVENING_HOUR).toBe(19);
    });
  });

  describe("legacy AXIS_ compatibility", () => {
    it("should parse legacy AXIS_* variables when canonical names are missing", async () => {
      process.env.AXIS_TIMEZONE = "Europe/Oslo";
      process.env.AXIS_USER_NAME = "Legacy User";
      process.env.AXIS_VAPID_PUBLIC_KEY = "legacy-public";
      process.env.AXIS_VAPID_PRIVATE_KEY = "legacy-private";
      process.env.AXIS_VAPID_SUBJECT = "mailto:legacy@example.com";
      process.env.AXIS_FALLBACK_EMAIL = "legacy@example.com";
      process.env.AXIS_NOTES_PROVIDER = "local";
      process.env.AXIS_ASSIGNMENT_PROVIDER = "manual";
      process.env.AXIS_FOOD_PROVIDER = "manual";
      process.env.AXIS_SOCIAL_PROVIDER = "manual";
      process.env.AXIS_VIDEO_PROVIDER = "manual";

      const { config } = await import("./config.js");

      expect(config.TIMEZONE).toBe("Europe/Oslo");
      expect(config.USER_NAME).toBe("Legacy User");
      expect(config.VAPID_PUBLIC_KEY).toBe("legacy-public");
      expect(config.VAPID_PRIVATE_KEY).toBe("legacy-private");
      expect(config.VAPID_SUBJECT).toBe("mailto:legacy@example.com");
      expect(config.FALLBACK_EMAIL).toBe("legacy@example.com");
      expect(config.NOTES_PROVIDER).toBe("local");
      expect(config.ASSIGNMENT_PROVIDER).toBe("manual");
      expect(config.FOOD_PROVIDER).toBe("manual");
      expect(config.SOCIAL_PROVIDER).toBe("manual");
      expect(config.VIDEO_PROVIDER).toBe("manual");
    });

    it("should prefer canonical names over legacy AXIS_* aliases", async () => {
      process.env.TIMEZONE = "America/Los_Angeles";
      process.env.AXIS_TIMEZONE = "Europe/Berlin";

      const { config } = await import("./config.js");
      expect(config.TIMEZONE).toBe("America/Los_Angeles");
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

    it("should accept empty string for TIMEZONE", async () => {
      process.env.TIMEZONE = "";
      const { config } = await import("./config.js");
      expect(config.TIMEZONE).toBe("");
    });

    it("should accept empty string for USER_NAME", async () => {
      process.env.USER_NAME = "";
      const { config } = await import("./config.js");
      expect(config.USER_NAME).toBe("");
    });
  });
});
