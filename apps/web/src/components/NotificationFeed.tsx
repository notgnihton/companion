import { Notification } from "../types";

interface NotificationFeedProps {
  notifications: Notification[];
}

export function NotificationFeed({ notifications }: NotificationFeedProps): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Notifications</h2>
      </header>
      <ul className="feed">
        {notifications.slice(0, 10).map((item) => (
          <li key={item.id} className={`feed-item priority-${item.priority}`}>
            <div className="feed-title-row">
              <strong>{item.title}</strong>
              <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
            </div>
            <p>{item.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
