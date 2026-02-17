import { useEffect, useMemo, useState } from "react";
import { getSocialMediaFeed, syncSocialMediaFeed } from "../lib/api";
import { loadSocialMediaCache, loadSocialMediaCachedAt } from "../lib/storage";
import type { SocialMediaFeed, SocialTweet, SocialVideo } from "../types";
import { ContentRecommendationsPanel } from "./ContentRecommendationsPanel";

type SocialFilter = "all" | "youtube" | "x";
const SOCIAL_STALE_MS = 6 * 60 * 60 * 1000;

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

function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "0:00";

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatCachedLabel(cachedAt: string | null): string {
  if (!cachedAt) {
    return "No cached snapshot yet";
  }

  const timestamp = new Date(cachedAt);
  if (Number.isNaN(timestamp.getTime())) {
    return "Cached snapshot time unavailable";
  }

  return `Cached ${timestamp.toLocaleString()}`;
}

export function SocialMediaView(): JSX.Element {
  const [feed, setFeed] = useState<SocialMediaFeed | null>(() => loadSocialMediaCache());
  const [loading, setLoading] = useState<boolean>(() => loadSocialMediaCache() === null);
  const [cachedAt, setCachedAt] = useState<string | null>(() => loadSocialMediaCachedAt());
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SocialFilter>("all");

  const loadFeed = async (): Promise<void> => {
    try {
      setError(null);
      const next = await getSocialMediaFeed();
      setFeed(next);
      setCachedAt(loadSocialMediaCachedAt());
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load social feed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void loadFeed();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleRefresh = async (): Promise<void> => {
    if (!isOnline) {
      setError("You're offline. Reconnect and tap refresh.");
      return;
    }

    setRefreshing(true);
    setError(null);

    try {
      await syncSocialMediaFeed();
      await loadFeed();
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : "Refresh failed";
      setError(message);
      await loadFeed();
    } finally {
      setRefreshing(false);
    }
  };

  const cacheAgeMs = cachedAt ? Date.now() - new Date(cachedAt).getTime() : Number.POSITIVE_INFINITY;
  const isStale = Number.isFinite(cacheAgeMs) && cacheAgeMs > SOCIAL_STALE_MS;

  const filteredVideos = useMemo<SocialVideo[]>(() => {
    if (!feed || filter === "x") return [];
    return feed.youtube.videos;
  }, [feed, filter]);

  const filteredTweets = useMemo<SocialTweet[]>(() => {
    if (!feed || filter === "youtube") return [];
    return feed.x.tweets;
  }, [feed, filter]);

  if (loading && !feed) {
    return (
      <section className="panel social-media-panel">
        <header className="panel-header">
          <h2>Social Digest</h2>
        </header>
        <p className="social-media-loading">Loading social feed...</p>
      </section>
    );
  }

  return (
    <section className="panel social-media-panel">
      <header className="panel-header social-media-header">
        <h2>Social Digest</h2>
        <button type="button" onClick={() => void handleRefresh()} disabled={refreshing || !isOnline}>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>
      <div className="cache-status-row" role="status" aria-live="polite">
        <span className={`cache-status-chip ${isOnline ? "cache-status-chip-online" : "cache-status-chip-offline"}`}>
          {isOnline ? "Online" : "Offline"}
        </span>
        <span className="cache-status-chip">{formatCachedLabel(cachedAt)}</span>
        {isStale && <span className="cache-status-chip cache-status-chip-stale">Stale snapshot</span>}
      </div>

      <div className="social-media-filter-row" role="tablist" aria-label="Platform filter">
        <button
          type="button"
          className={`social-filter-chip ${filter === "all" ? "social-filter-chip-active" : ""}`}
          onClick={() => setFilter("all")}
          role="tab"
          aria-selected={filter === "all"}
        >
          All
        </button>
        <button
          type="button"
          className={`social-filter-chip ${filter === "youtube" ? "social-filter-chip-active" : ""}`}
          onClick={() => setFilter("youtube")}
          role="tab"
          aria-selected={filter === "youtube"}
        >
          YouTube
        </button>
        <button
          type="button"
          className={`social-filter-chip ${filter === "x" ? "social-filter-chip-active" : ""}`}
          onClick={() => setFilter("x")}
          role="tab"
          aria-selected={filter === "x"}
        >
          X
        </button>
      </div>

      {error && <p className="social-media-error">{error}</p>}

      {feed && (
        <p className="social-media-sync-note">
          Last synced: YouTube {feed.youtube.lastSyncedAt ? formatRelativeTime(feed.youtube.lastSyncedAt) : "never"} •
          X {feed.x.lastSyncedAt ? ` ${formatRelativeTime(feed.x.lastSyncedAt)}` : " never"}
        </p>
      )}

      <ContentRecommendationsPanel context="social" limit={6} />

      <div className="social-media-content-grid">
        {filteredVideos.map((video) => (
          <a
            key={video.id}
            className="social-card social-video-card"
            href={`https://www.youtube.com/watch?v=${video.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <div className="social-video-thumb-wrap">
              <img src={video.thumbnailUrl} alt={video.title} className="social-video-thumb" loading="lazy" />
              <span className="social-video-duration">{formatDuration(video.duration)}</span>
            </div>
            <div className="social-card-body">
              <p className="social-card-source">{video.channelTitle}</p>
              <h3 className="social-card-title">{video.title}</h3>
              <p className="social-card-meta">
                {formatRelativeTime(video.publishedAt)} • {video.viewCount.toLocaleString()} views
              </p>
            </div>
          </a>
        ))}

        {filteredTweets.map((tweet) => (
          <a
            key={tweet.id}
            className="social-card social-tweet-card"
            href={`https://x.com/${tweet.authorUsername}/status/${tweet.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <div className="social-card-body">
              <p className="social-card-source">
                {tweet.authorName} @{tweet.authorUsername}
              </p>
              <p className="social-tweet-text">{tweet.text}</p>
              <p className="social-card-meta">
                {formatRelativeTime(tweet.createdAt)} • {tweet.likeCount} likes • {tweet.retweetCount} reposts
              </p>
            </div>
          </a>
        ))}
      </div>

      {feed && filteredVideos.length === 0 && filteredTweets.length === 0 && (
        <p className="social-media-empty">No social content available for this filter yet.</p>
      )}
    </section>
  );
}
