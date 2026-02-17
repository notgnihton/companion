import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { CanvasClient } from "./canvas-client.js";
import { CanvasSyncService } from "./canvas-sync.js";
import { CanvasData } from "./types.js";

describe("Canvas Integration", () => {
  let store: RuntimeStore;
  
  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("CanvasClient", () => {
    it("should construct with default config", () => {
      const client = new CanvasClient();
      expect(client).toBeDefined();
    });

    it("should construct with custom config", () => {
      const client = new CanvasClient("https://custom.instructure.com", "test-token");
      expect(client).toBeDefined();
    });

    it("should throw error when fetching without token", async () => {
      const client = new CanvasClient("https://test.instructure.com", undefined);
      await expect(client.getCourses()).rejects.toThrow("Canvas API token not configured");
    });
  });

  describe("CanvasSyncService", () => {
    it("should construct with store", () => {
      const service = new CanvasSyncService(store);
      expect(service).toBeDefined();
    });

    it("should allow manual trigger", async () => {
      const mockClient = {
        getCourses: async () => [],
        getAllAssignments: async () => [],
        getAllModules: async () => [],
        getAnnouncements: async () => []
      } as unknown as CanvasClient;

      const service = new CanvasSyncService(store, mockClient);
      const result = await service.triggerSync();
      
      expect(result.success).toBe(true);
      expect(result.coursesCount).toBe(0);
      expect(result.assignmentsCount).toBe(0);
      expect(result.modulesCount).toBe(0);
      expect(result.announcementsCount).toBe(0);
    });

    it("filters assignments to integration date window before storing and bridging", async () => {
      const mockClient = {
        getCourses: async () => [
          { id: 7, name: "DAT560", course_code: "DAT560", workflow_state: "available" }
        ],
        getAllAssignments: async () => [
          {
            id: 1,
            name: "Near assignment",
            description: null,
            due_at: "2026-03-01T23:59:00.000Z",
            points_possible: 100,
            course_id: 7,
            submission_types: ["online_upload"],
            has_submitted_submissions: false
          },
          {
            id: 2,
            name: "Far assignment",
            description: null,
            due_at: "2027-01-01T23:59:00.000Z",
            points_possible: 100,
            course_id: 7,
            submission_types: ["online_upload"],
            has_submitted_submissions: false
          }
        ],
        getAllModules: async () => [],
        getAnnouncements: async () => []
      } as unknown as CanvasClient;

      const service = new CanvasSyncService(store, mockClient);
      const result = await service.triggerSync();

      expect(result.success).toBe(true);
      expect(result.assignmentsCount).toBe(1);
      expect(result.deadlineBridge?.created).toBe(1);
      const canvasData = store.getCanvasData();
      expect(canvasData?.assignments).toHaveLength(1);
      expect(canvasData?.assignments[0]?.id).toBe(1);
    });

    it("should use override token and baseUrl when provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const json = async (): Promise<unknown> => {
          if (url.includes("/courses")) {
            return [
              { id: 42, name: "Manual Course", course_code: "MC1", workflow_state: "available" }
            ];
          }
          return [];
        };

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json,
          headers: init?.headers ?? {}
        } as unknown as Response;
      });

      const service = new CanvasSyncService(store);
      const result = await service.sync({
        baseUrl: "https://manual.canvas.test",
        token: "token-123"
      });

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
      const [firstUrl, firstInit] = fetchSpy.mock.calls[0] ?? [];
      const urlString = typeof firstUrl === "string" ? firstUrl : firstUrl?.toString() ?? "";
      expect(urlString.startsWith("https://manual.canvas.test")).toBe(true);
      const headers = (firstInit?.headers as Record<string, string>) ?? {};
      expect(headers.Authorization).toBe("Bearer token-123");
    });
  });

  describe("RuntimeStore Canvas methods", () => {
    it("should return null when no Canvas data exists", () => {
      const data = store.getCanvasData();
      expect(data).toBeNull();
    });

    it("should store and retrieve Canvas data", () => {
      const canvasData: CanvasData = {
        courses: [
          {
            id: 123,
            name: "Test Course",
            course_code: "TEST101",
            workflow_state: "available"
          }
        ],
        assignments: [
          {
            id: 456,
            name: "Test Assignment",
            description: "Test description",
            due_at: "2026-03-01T23:59:00Z",
            points_possible: 100,
            course_id: 123,
            submission_types: ["online_text_entry"],
            has_submitted_submissions: false
          }
        ],
        modules: [
          {
            id: 789,
            name: "Week 1",
            position: 1,
            unlock_at: null,
            require_sequential_progress: false,
            state: "unlocked"
          }
        ],
        announcements: [
          {
            id: 101,
            title: "Welcome",
            message: "Welcome to the course!",
            posted_at: "2026-02-15T10:00:00Z",
            author: { display_name: "Professor" },
            context_code: "course_123"
          }
        ],
        lastSyncedAt: "2026-02-16T15:00:00Z"
      };

      store.setCanvasData(canvasData);
      const retrieved = store.getCanvasData();

      expect(retrieved).toBeDefined();
      expect(retrieved?.courses).toHaveLength(1);
      expect(retrieved?.courses[0].name).toBe("Test Course");
      expect(retrieved?.assignments).toHaveLength(1);
      expect(retrieved?.assignments[0].name).toBe("Test Assignment");
      expect(retrieved?.modules).toHaveLength(1);
      expect(retrieved?.modules[0].name).toBe("Week 1");
      expect(retrieved?.announcements).toHaveLength(1);
      expect(retrieved?.announcements[0].title).toBe("Welcome");
      expect(retrieved?.lastSyncedAt).toBe("2026-02-16T15:00:00Z");
    });

    it("should update Canvas data on subsequent set", () => {
      const data1: CanvasData = {
        courses: [{ id: 1, name: "Course 1", course_code: "C1", workflow_state: "available" }],
        assignments: [],
        modules: [],
        announcements: [],
        lastSyncedAt: "2026-02-16T15:00:00Z"
      };

      store.setCanvasData(data1);

      const data2: CanvasData = {
        courses: [
          { id: 1, name: "Course 1", course_code: "C1", workflow_state: "available" },
          { id: 2, name: "Course 2", course_code: "C2", workflow_state: "available" }
        ],
        assignments: [],
        modules: [],
        announcements: [],
        lastSyncedAt: "2026-02-16T16:00:00Z"
      };

      store.setCanvasData(data2);
      const retrieved = store.getCanvasData();

      expect(retrieved?.courses).toHaveLength(2);
      expect(retrieved?.lastSyncedAt).toBe("2026-02-16T16:00:00Z");
    });
  });
});
