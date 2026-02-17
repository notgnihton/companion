import { useEffect, useState } from "react";
import { getContentRecommendations } from "../lib/api";
import { ContentRecommendation } from "../types";

interface ContentRecommendationsPanelProps {
  context: "chat" | "social";
  limit: number;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs)) return "Unknown";
  if (diffMs < 0) return date.toLocaleDateString();

  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

function platformLabel(platform: "youtube" | "x"): string {
  return platform === "youtube" ? "YouTube" : "X";
}

function buildChatPrompt(rec: ContentRecommendation): string {
  return `Help me study ${rec.target.course} ${rec.target.title} using ${rec.content.title}.`;
}

export function ContentRecommendationsPanel({ context, limit }: ContentRecommendationsPanelProps): JSX.Element {
  const [items, setItems] = useState<ContentRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadRecommendations = async (isRefresh = false): Promise<void> => {
    if (isRefresh) {
      setRefreshing(true);
    }
    setError("");

    try {
      const response = await getContentRecommendations({ horizonDays: 7, limit });
      setItems(response.recommendations);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load recommendations.";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadRecommendations();
  }, [limit]);

  const handleCopyPrompt = async (recommendation: ContentRecommendation): Promise<void> => {
    const prompt = buildChatPrompt(recommendation);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedId(recommendation.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Unable to copy prompt.");
    }
  };

  return (
    <section className={`recommendations-panel recommendations-panel-${context}`}>
      <header className="recommendations-header">
        <h3>{context === "chat" ? "Recommended for your courses" : "Recommended for upcoming work"}</h3>
        <button type="button" onClick={() => void loadRecommendations(true)} disabled={refreshing}>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {loading && <p className="recommendations-empty">Loading recommendations...</p>}
      {error && <p className="recommendations-error">{error}</p>}

      {!loading && items.length === 0 && <p className="recommendations-empty">No recommendations available yet.</p>}

      <div className="recommendations-grid">
        {items.map((recommendation) => (
          <article key={recommendation.id} className="recommendation-card">
            <div className="recommendation-badges">
              <span className="recommendation-badge recommendation-badge-course">{recommendation.target.course}</span>
              <span className="recommendation-badge">{platformLabel(recommendation.content.platform)}</span>
            </div>

            <h4 className="recommendation-title">{recommendation.content.title}</h4>
            <p className="recommendation-target">
              For {recommendation.target.title} ({recommendation.target.type})
            </p>
            <p className="recommendation-reason">{recommendation.reason}</p>
            <p className="recommendation-meta">
              {recommendation.content.author} • {formatRelativeTime(recommendation.content.publishedAt)}
            </p>

            {recommendation.matchedKeywords.length > 0 && (
              <p className="recommendation-keywords">
                {recommendation.matchedKeywords.slice(0, 3).join(" • ")}
              </p>
            )}

            <div className="recommendation-actions">
              <a href={recommendation.content.url} target="_blank" rel="noreferrer">
                Open {platformLabel(recommendation.content.platform)}
              </a>
              <button type="button" onClick={() => void handleCopyPrompt(recommendation)}>
                {copiedId === recommendation.id ? "Prompt copied" : "Copy chat prompt"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
