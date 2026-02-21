import { describe, it, expect } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore GitHub course data", () => {
  const userId = "test-user";

  it("returns null when no GitHub course data has been synced", () => {
    const store = new RuntimeStore(":memory:");
    expect(store.getGitHubCourseData(userId)).toBeNull();
  });

  it("persists and retrieves GitHub course data payload", () => {
    const store = new RuntimeStore(":memory:");

    store.setGitHubCourseData(userId, {
      repositories: [{ owner: "dat560-2026", repo: "info", courseCode: "DAT560" }],
      documents: [
        {
          id: "github-doc-dat560-demo",
          courseCode: "DAT560",
          owner: "dat560-2026",
          repo: "info",
          path: "README.md",
          url: "https://github.com/dat560-2026/info/blob/HEAD/README.md",
          title: "DAT560 Syllabus",
          summary: "Key milestones and assessment details for DAT560.",
          highlights: ["Project deliverable due March 10", "Final exam June 2"],
          snippet: "DAT560 syllabus excerpt",
          syncedAt: "2026-02-17T00:00:00.000Z"
        }
      ],
      deadlinesSynced: 4,
      lastSyncedAt: "2026-02-17T00:00:00.000Z"
    });

    const data = store.getGitHubCourseData(userId);

    expect(data).not.toBeNull();
    expect(data?.repositories).toHaveLength(1);
    expect(data?.documents).toHaveLength(1);
    expect(data?.deadlinesSynced).toBe(4);
    expect(data?.lastSyncedAt).toBe("2026-02-17T00:00:00.000Z");
  });
});
