import { useEffect, useState } from "react";
import { submitJournalEntry, syncQueuedJournalEntries, searchJournalEntries } from "../lib/api";
import {
  addJournalEntry,
  enqueueJournalEntry,
  loadJournalEntries,
  loadJournalQueue
} from "../lib/storage";
import { JournalEntry } from "../types";

export function JournalView(): JSX.Element {
  const [entries, setEntries] = useState<JournalEntry[]>(loadJournalEntries());
  const [displayedEntries, setDisplayedEntries] = useState<JournalEntry[]>(loadJournalEntries());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const sync = async (): Promise<void> => {
      const synced = await syncQueuedJournalEntries(loadJournalQueue());
      if (synced > 0) {
        const updated = loadJournalEntries();
        setEntries(updated);
        applyFilters(updated);
        setSyncMessage(`Synced ${synced} queued journal entr${synced === 1 ? "y" : "ies"}.`);
      }
    };

    const handleOnline = (): void => {
      void sync();
    };

    window.addEventListener("online", handleOnline);
    void sync();

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    applyFilters(entries);
  }, [searchQuery, startDate, endDate, entries]);

  const applyFilters = (entriesList: JournalEntry[]): void => {
    let filtered = [...entriesList];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (entry) =>
          entry.text.toLowerCase().includes(query) ||
          entry.content.toLowerCase().includes(query)
      );
    }

    if (startDate) {
      const start = new Date(startDate);
      filtered = filtered.filter((entry) => new Date(entry.timestamp) >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((entry) => new Date(entry.timestamp) <= end);
    }

    setDisplayedEntries(filtered);
  };

  const handleSearch = async (): Promise<void> => {
    if (!searchQuery.trim() && !startDate && !endDate) {
      setDisplayedEntries(entries);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchJournalEntries(
        searchQuery.trim() || undefined,
        startDate || undefined,
        endDate || undefined
      );

      if (results) {
        const withTextFields = results.map((entry) => ({
          ...entry,
          text: entry.content || entry.text
        }));
        setDisplayedEntries(withTextFields);
      } else {
        applyFilters(entries);
      }
    } catch {
      applyFilters(entries);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearFilters = (): void => {
    setSearchQuery("");
    setStartDate("");
    setEndDate("");
    setDisplayedEntries(entries);
  };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!text.trim()) return;

    setBusy(true);
    try {
      const entry = addJournalEntry(text.trim());
      const updated = [entry, ...entries];
      setEntries(updated);
      applyFilters(updated);
      setText("");

      const submitted = await submitJournalEntry(entry.text, entry.clientEntryId ?? entry.id);
      if (!submitted) {
        enqueueJournalEntry(entry);
        setSyncMessage("Saved offline. Will sync when connection returns.");
        return;
      }

      setSyncMessage("");
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined
    });
  };

  return (
    <section className="panel journal-panel">
      <header className="panel-header">
        <h2>Journal</h2>
        <span className="journal-count">{entries.length} entries</span>
      </header>
      {syncMessage && <p className="journal-sync-status">{syncMessage}</p>}

      <form className="journal-input-form" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          className="journal-textarea"
          placeholder="What's on your mind? Quick thoughts, reflections, or to-dos..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {busy ? "Saving..." : "Add Entry"}
        </button>
      </form>

      <div className="journal-filters">
        <input
          type="text"
          className="journal-search-input"
          placeholder="Search entries..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="journal-date-filters">
          <input
            type="date"
            className="journal-date-input"
            placeholder="Start date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
          />
          <input
            type="date"
            className="journal-date-input"
            placeholder="End date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End date"
          />
        </div>
        <div className="journal-filter-actions">
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={isSearching}
            className="journal-search-btn"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
          {(searchQuery || startDate || endDate) && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="journal-clear-btn"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {displayedEntries.length > 0 ? (
        <ul className="journal-list">
          {displayedEntries.map((entry) => (
            <li key={entry.id} className="journal-entry">
              <p className="journal-entry-text">{entry.text}</p>
              <time className="journal-entry-time">{formatDate(entry.timestamp)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="journal-empty">
          {searchQuery || startDate || endDate
            ? "No entries found matching your filters."
            : "No entries yet. Start journaling to track your thoughts."}
        </p>
      )}
    </section>
  );
}
