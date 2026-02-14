import { AgentStatusList } from "./components/AgentStatusList";
import { ContextControls } from "./components/ContextControls";
import { DeadlineList } from "./components/DeadlineList";
import { JournalView } from "./components/JournalView";
import { NotificationFeed } from "./components/NotificationFeed";
import { ScheduleView } from "./components/ScheduleView";
import { SummaryTiles } from "./components/SummaryTiles";
import { useDashboard } from "./hooks/useDashboard";

export default function App(): JSX.Element {
  const { data, loading, error, refresh } = useDashboard();

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Companion</p>
          <h1>Personal AI Assistant</h1>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      {loading && <p>Loading dashboard...</p>}
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <SummaryTiles
            todayFocus={data.summary.todayFocus}
            pendingDeadlines={data.summary.pendingDeadlines}
            activeAgents={data.summary.activeAgents}
            journalStreak={data.summary.journalStreak}
          />
          <JournalView />
          <div className="grid-two">
            <ScheduleView />
            <DeadlineList />
          </div>
          <div className="grid-two">
            <AgentStatusList states={data.agentStates} />
            <NotificationFeed notifications={data.notifications} />
          </div>
          <ContextControls onUpdated={refresh} />
        </>
      )}
    </main>
  );
}
