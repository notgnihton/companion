import { ChatView } from "./ChatView";
import { ContentRecommendationsPanel } from "./ContentRecommendationsPanel";

interface ChatTabProps {
  todayFocus: string;
  pendingDeadlines: number;
  activeAgents: number;
  journalStreak: number;
}

export function ChatTab(props: ChatTabProps): JSX.Element {
  return (
    <div className="chat-tab">
      {/* Contextual summary cards above chat */}
      <div className="chat-context-cards">
        <article className="context-card">
          <h3>📌 Today</h3>
          <p>{props.todayFocus}</p>
        </article>
        <article className="context-card">
          <h3>⚠️ Deadlines</h3>
          <p>{props.pendingDeadlines} pending</p>
        </article>
        <article className="context-card">
          <h3>🤖 Agents</h3>
          <p>{props.activeAgents} active</p>
        </article>
        <article className="context-card">
          <h3>🔥 Streak</h3>
          <p>{props.journalStreak} days</p>
        </article>
      </div>

      <ContentRecommendationsPanel context="chat" limit={3} />
      
      {/* Chat interface */}
      <ChatView />
    </div>
  );
}
