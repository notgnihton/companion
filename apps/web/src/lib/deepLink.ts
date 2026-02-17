import type { TabId } from "../components/TabBar";

export interface DeepLinkState {
  tab: TabId | null;
  deadlineId: string | null;
  lectureId: string | null;
  section: string | null;
}

const tabIds: TabId[] = ["chat", "schedule", "social", "habits", "analytics", "settings"];

function isTabId(value: string | null): value is TabId {
  return value !== null && tabIds.includes(value as TabId);
}

export function parseDeepLink(search: string): DeepLinkState {
  const params = new URLSearchParams(search);

  const rawTab = params.get("tab");
  const rawDeadlineId = params.get("deadlineId");
  const rawLectureId = params.get("lectureId");
  const rawSection = params.get("section");
  const normalizedTab = rawTab === "journal" ? "habits" : rawTab;

  return {
    tab: isTabId(normalizedTab) ? normalizedTab : null,
    deadlineId: rawDeadlineId && rawDeadlineId.trim().length > 0 ? rawDeadlineId.trim() : null,
    lectureId: rawLectureId && rawLectureId.trim().length > 0 ? rawLectureId.trim() : null,
    section: rawSection && rawSection.trim().length > 0 ? rawSection.trim() : null
  };
}
