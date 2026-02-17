import { useEffect, useState } from "react";
import { ScheduleView } from "./ScheduleView";
import { DeadlineList } from "./DeadlineList";
import { StudyPlanView } from "./StudyPlanView";

interface ScheduleTabProps {
  scheduleKey: string;
  focusDeadlineId?: string;
}

export function ScheduleTab({ scheduleKey, focusDeadlineId }: ScheduleTabProps): JSX.Element {
  const [activeView, setActiveView] = useState<"schedule" | "study-plan">("schedule");

  useEffect(() => {
    if (focusDeadlineId) {
      setActiveView("schedule");
    }
  }, [focusDeadlineId]);

  return (
    <div className="schedule-tab-container">
      <div className="schedule-tab-header">
        <h2>{activeView === "schedule" ? "Schedule" : "Study Plan"}</h2>
        <div className="schedule-tab-switcher" role="tablist" aria-label="Schedule view mode">
          <button
            type="button"
            className={activeView === "schedule" ? "schedule-tab-switcher-active" : ""}
            onClick={() => setActiveView("schedule")}
            role="tab"
            aria-selected={activeView === "schedule"}
          >
            Schedule
          </button>
          <button
            type="button"
            className={activeView === "study-plan" ? "schedule-tab-switcher-active" : ""}
            onClick={() => setActiveView("study-plan")}
            role="tab"
            aria-selected={activeView === "study-plan"}
          >
            Study Plan
          </button>
        </div>
      </div>

      {activeView === "schedule" ? (
        <div className="schedule-grid">
          <ScheduleView key={scheduleKey} />
          <DeadlineList key={`deadline-${scheduleKey}`} focusDeadlineId={focusDeadlineId} />
        </div>
      ) : (
        <StudyPlanView />
      )}
    </div>
  );
}
