import type { TabId } from "../components/TabBar";

export interface DeepLinkState {
  tab: TabId | null;
  deadlineId: string | null;
  section: string | null;
}

const tabIds: TabId[] = ["chat", "schedule", "social", "journal", "analytics", "settings"];

function isTabId(value: string | null): value is TabId {
  return value !== null && tabIds.includes(value as TabId);
}

export function parseDeepLink(search: string): DeepLinkState {
  const params = new URLSearchParams(search);

  const rawTab = params.get("tab");
  const rawDeadlineId = params.get("deadlineId");
  const rawSection = params.get("section");

  return {
    tab: isTabId(rawTab) ? rawTab : null,
    deadlineId: rawDeadlineId && rawDeadlineId.trim().length > 0 ? rawDeadlineId.trim() : null,
    section: rawSection && rawSection.trim().length > 0 ? rawSection.trim() : null
  };
}
