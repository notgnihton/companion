interface SummaryTilesProps {
  todayFocus: string;
  pendingDeadlines: number;
  mealCompliance: number;
  digestReady: boolean;
}

export function SummaryTiles(props: SummaryTilesProps): JSX.Element {
  return (
    <section className="tile-grid" aria-label="Summary">
      <article className="tile">
        <h2>Today Focus</h2>
        <p>{props.todayFocus}</p>
      </article>
      <article className="tile">
        <h2>Deadlines</h2>
        <p>{props.pendingDeadlines}</p>
      </article>
      <article className="tile">
        <h2>Meal Compliance</h2>
        <p>{props.mealCompliance}%</p>
      </article>
      <article className="tile">
        <h2>Digest</h2>
        <p>{props.digestReady ? "Ready" : "Pending"}</p>
      </article>
    </section>
  );
}
