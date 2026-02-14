import { AgentState } from "../types";

interface AgentStatusListProps {
  states: AgentState[];
}

export function AgentStatusList({ states }: AgentStatusListProps): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Agent Runtime</h2>
      </header>
      <ul className="list">
        {states.map((agent) => (
          <li key={agent.name} className="list-item">
            <span>{agent.name}</span>
            <span className={`status status-${agent.status}`}>{agent.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
