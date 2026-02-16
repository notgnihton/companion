export interface PullToRefreshIndicatorProps {
  pullDistance: number;
  threshold: number;
  isRefreshing: boolean;
}

/**
 * Visual indicator for pull-to-refresh gesture.
 * Shows progress and spinning animation during refresh.
 */
export function PullToRefreshIndicator({
  pullDistance,
  threshold,
  isRefreshing
}: PullToRefreshIndicatorProps): JSX.Element {
  const progress = Math.min(pullDistance / threshold, 1);
  const opacity = Math.min(progress * 1.5, 1);
  const rotation = isRefreshing ? 360 : progress * 360;

  return (
    <div
      className="pull-to-refresh-indicator"
      style={{
        transform: `translateY(${pullDistance}px)`,
        opacity
      }}
    >
      <div
        className={`pull-to-refresh-spinner ${isRefreshing ? "spinning" : ""}`}
        style={{
          transform: `rotate(${rotation}deg)`
        }}
      >
        ↻
      </div>
      {!isRefreshing && progress >= 1 && (
        <span className="pull-to-refresh-text">Release to refresh</span>
      )}
      {!isRefreshing && progress < 1 && progress > 0 && (
        <span className="pull-to-refresh-text">Pull to refresh</span>
      )}
      {isRefreshing && (
        <span className="pull-to-refresh-text">Refreshing...</span>
      )}
    </div>
  );
}
