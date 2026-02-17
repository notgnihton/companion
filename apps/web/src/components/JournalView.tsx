import { useEffect, useRef, useState } from "react";
import { deleteJournalEntry, getJournalEntries, searchJournalEntries, submitJournalEntry } from "../lib/api";
import {
  loadArchivedJournalIds,
  loadJournalEntries,
  saveJournalEntries,
  saveArchivedJournalIds
} from "../lib/storage";
import { JournalEntry, JournalPhoto } from "../types";
import { TagInput } from "./TagInput";
import { useSharedContent } from "../hooks/useSharedContent";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";
import { SwipeableListItem } from "./SwipeableListItem";
import { hapticNotice, hapticSuccess } from "../lib/haptics";

interface UndoToast {
  message: string;
  onUndo: () => void;
}

interface JournalViewProps {
  focusJournalId?: string;
}

export function JournalView({ focusJournalId }: JournalViewProps): JSX.Element {
  const normalizeEntry = (entry: JournalEntry): JournalEntry => ({
    ...entry,
    text: entry.text ?? entry.content,
    photos: entry.photos ?? []
  });

  const initialEntries = loadJournalEntries().map(normalizeEntry);
  const sharedContent = useSharedContent();

  const [entries, setEntries] = useState<JournalEntry[]>(initialEntries);
  const [displayedEntries, setDisplayedEntries] = useState<JournalEntry[]>(initialEntries);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<JournalPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => new Set(loadArchivedJournalIds()));
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const pendingDeleteRef = useRef<Map<string, number>>(new Map());

  const handleRefresh = async (): Promise<void> => {
    const latest = await getJournalEntries();
    if (!latest) {
      setSyncMessage("Could not refresh journal right now.");
      setTimeout(() => setSyncMessage(""), 2000);
      return;
    }

    const normalized = latest.map(normalizeEntry);
    setEntries(normalized);
    applyFilters(normalized);
    setSyncMessage("Journal refreshed.");
    setTimeout(() => setSyncMessage(""), 2000);
  };

  const { containerRef, isPulling, pullDistance, isRefreshing } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handleRefresh,
    threshold: 80
  });

  // Handle shared content from Web Share Target API
  useEffect(() => {
    if (sharedContent) {
      setText(sharedContent.text);
      setPhotos(sharedContent.photos);
      setSyncMessage("Shared content ready to journal!");
    }
  }, [sharedContent]);

  useEffect(() => {
    const refresh = async (): Promise<void> => {
      const latest = await getJournalEntries();
      if (latest) {
        const normalized = latest.map(normalizeEntry);
        setEntries(normalized);
        applyFilters(normalized);
      }
    };

    const handleOnline = (): void => {
      void refresh();
    };

    window.addEventListener("online", handleOnline);
    void refresh();

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    applyFilters(entries);
  }, [searchQuery, startDate, endDate, filterTags, entries]);

  useEffect(() => {
    if (!focusJournalId) {
      return;
    }

    const timer = window.setTimeout(() => {
      const target = document.getElementById(`journal-${focusJournalId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [focusJournalId, displayedEntries, archivedIds]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current);
      }

      pendingDeleteRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      pendingDeleteRef.current.clear();
    };
  }, []);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Unable to read file"));
      reader.readAsDataURL(file);
    });

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    if (!event.target.files) return;
    const files = Array.from(event.target.files);
    const remainingSlots = Math.max(0, 5 - photos.length);
    const selected = files.slice(0, remainingSlots);

    const uploads = await Promise.all(
      selected.map(async (file) => ({
        id: crypto.randomUUID(),
        dataUrl: await fileToDataUrl(file),
        fileName: file.name
      }))
    );

    setPhotos((prev) => [...prev, ...uploads]);
    event.target.value = "";
  };

  const removePhoto = (id?: string): void => {
    if (!id) return;
    setPhotos((prev) => prev.filter((photo) => photo.id !== id));
  };

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

    if (filterTags.length > 0) {
      filtered = filtered.filter((entry) => 
        filterTags.every((tag) => entry.tags?.includes(tag))
      );
    }

    setDisplayedEntries(filtered);
  };

  const handleSearch = async (): Promise<void> => {
    if (!searchQuery.trim() && !startDate && !endDate && filterTags.length === 0) {
      setDisplayedEntries(entries);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchJournalEntries(
        searchQuery.trim() || undefined,
        startDate || undefined,
        endDate || undefined,
        filterTags.length > 0 ? filterTags : undefined
      );

      if (results) {
        const withTextFields = results.map((entry) => ({
          ...entry,
          text: entry.content || entry.text,
          photos: entry.photos ?? []
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
    setFilterTags([]);
    setDisplayedEntries(entries);
  };

  const sortByNewest = (items: JournalEntry[]): JournalEntry[] => {
    return [...items].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const showUndoToast = (message: string, onUndo: () => void): void => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
    }

    setUndoToast({ message, onUndo });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoToast(null);
      undoTimerRef.current = null;
    }, 5000);
  };

  const archiveEntry = (entry: JournalEntry): void => {
    if (archivedIds.has(entry.id)) return;

    const nextArchived = new Set(archivedIds);
    nextArchived.add(entry.id);
    setArchivedIds(nextArchived);
    saveArchivedJournalIds(Array.from(nextArchived));
    hapticSuccess();

    showUndoToast("Entry archived.", () => {
      const restoredArchived = new Set(nextArchived);
      restoredArchived.delete(entry.id);
      setArchivedIds(restoredArchived);
      saveArchivedJournalIds(Array.from(restoredArchived));
    });
  };

  const queueDeleteEntry = (entry: JournalEntry): void => {
    setEntries((prev) => prev.filter((candidate) => candidate.id !== entry.id));

    if (archivedIds.has(entry.id)) {
      const nextArchived = new Set(archivedIds);
      nextArchived.delete(entry.id);
      setArchivedIds(nextArchived);
      saveArchivedJournalIds(Array.from(nextArchived));
    }

    hapticNotice();

    const timer = window.setTimeout(async () => {
      pendingDeleteRef.current.delete(entry.id);
      const deleted = await deleteJournalEntry(entry.id);
      if (!deleted) {
        setSyncMessage("Entry removed locally but could not be deleted on server.");
      }
    }, 5000);
    pendingDeleteRef.current.set(entry.id, timer);

    showUndoToast("Entry deleted.", () => {
      const pending = pendingDeleteRef.current.get(entry.id);
      if (pending) {
        window.clearTimeout(pending);
        pendingDeleteRef.current.delete(entry.id);
      }

      setEntries((prev) => sortByNewest([...prev, entry]));
    });
  };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!text.trim()) return;

    setBusy(true);
    try {
      const submitted = await submitJournalEntry(text.trim(), crypto.randomUUID(), tags, photos);
      if (!submitted) {
        setSyncMessage("Could not save entry. Please try again.");
        return;
      }

      const normalizedSubmitted = normalizeEntry(submitted);
      const updated = sortByNewest([
        normalizedSubmitted,
        ...entries.filter((entry) => (entry.clientEntryId ?? entry.id) !== (normalizedSubmitted.clientEntryId ?? normalizedSubmitted.id))
      ]);
      setEntries(updated);
      saveJournalEntries(updated);
      applyFilters(updated);
      setText("");
      setTags([]);
      setPhotos([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setSyncMessage("");
    } finally {
      setBusy(false);
    }
  };

  const startListening = (): void => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setSyncMessage("Voice input is not supported in this browser.");
      return;
    }

    const SpeechRecognitionAPI = (window.SpeechRecognition || window.webkitSpeechRecognition) as typeof SpeechRecognition;
    const recognition = new SpeechRecognitionAPI();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setSyncMessage("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        setText((prev) => (prev + " " + finalTranscript).trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      if (event.error === "no-speech") {
        setSyncMessage("No speech detected. Try again.");
      } else if (event.error === "not-allowed") {
        setSyncMessage("Microphone access denied. Please allow microphone permissions.");
      } else {
        setSyncMessage("Voice input error. Please try again.");
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = (): void => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsListening(false);
    }
  };

  const toggleVoiceInput = (): void => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
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

  const visibleEntries = displayedEntries.filter((entry) => !archivedIds.has(entry.id));

  const ensureTextareaInView = (): void => {
    window.setTimeout(() => {
      textareaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
  };

  return (
    <section className="panel journal-panel">
      <header className="panel-header">
        <h2>Journal</h2>
        <span className="journal-count">{entries.length} entries</span>
      </header>
      {syncMessage && <p className="journal-sync-status">{syncMessage}</p>}

      <form className="journal-input-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="journal-input-wrapper">
          <textarea
            ref={textareaRef}
            className="journal-textarea"
            placeholder="What's on your mind? Quick thoughts, reflections, or to-dos..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={ensureTextareaInView}
            rows={3}
            disabled={busy}
          />
        <button
          type="button"
          className={`journal-voice-btn ${isListening ? "listening" : ""}`}
          onClick={toggleVoiceInput}
          disabled={busy}
            aria-label={isListening ? "Stop voice input" : "Start voice input"}
            title={isListening ? "Stop voice input" : "Start voice input"}
          >
            {isListening ? "⏹" : "🎤"}
          </button>
        </div>
        <div className="journal-photo-upload">
          <label className="journal-photo-label">
            Attach photos
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => void handlePhotoChange(event)}
              disabled={busy}
            />
          </label>
          {photos.length > 0 && (
            <div className="journal-photo-previews">
              {photos.map((photo) => (
                <div key={photo.id} className="journal-photo-preview">
                  <img
                    src={photo.dataUrl}
                    alt={photo.fileName ?? "Journal attachment"}
                    className="journal-photo-thumb"
                  />
                  <button
                    type="button"
                    className="journal-photo-remove"
                    onClick={() => removePhoto(photo.id)}
                    aria-label="Remove photo"
                    disabled={busy}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <TagInput tags={tags} onTagsChange={setTags} disabled={busy} />
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
        <div className="journal-tag-filter">
          <label className="journal-filter-label">Filter by tags:</label>
          <TagInput tags={filterTags} onTagsChange={setFilterTags} disabled={false} />
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
          {(searchQuery || startDate || endDate || filterTags.length > 0) && (
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

      <div 
        ref={containerRef}
        className="pull-to-refresh-container"
      >
        {(isPulling || isRefreshing) && (
          <PullToRefreshIndicator
            pullDistance={pullDistance}
            threshold={80}
            isRefreshing={isRefreshing}
          />
        )}
        {visibleEntries.length > 0 ? (
          <ul className="journal-list">
            {visibleEntries.map((entry) => (
              <SwipeableListItem
                key={entry.id}
                itemId={`journal-${entry.id}`}
                className={`journal-entry ${focusJournalId === entry.id ? "journal-entry-focused" : ""}`}
                onSwipeRight={() => archiveEntry(entry)}
                onSwipeLeft={() => queueDeleteEntry(entry)}
                rightActionLabel="Archive"
                leftActionLabel="Delete"
                disabled={busy}
              >
                <p className="journal-entry-text">{entry.text}</p>
                {entry.tags && entry.tags.length > 0 && (
                  <div className="journal-entry-tags">
                    {entry.tags.map((tag) => (
                      <span key={tag} className="journal-tag-pill">{tag}</span>
                    ))}
                  </div>
                )}
                {entry.photos && entry.photos.length > 0 && (
                  <div className="journal-entry-photos">
                    {entry.photos.map((photo) => (
                      <img
                        key={photo.id}
                        src={photo.dataUrl}
                        alt={photo.fileName ?? "Journal attachment"}
                        className="journal-entry-photo"
                      />
                    ))}
                  </div>
                )}
                <time className="journal-entry-time">{formatDate(entry.timestamp)}</time>
              </SwipeableListItem>
            ))}
          </ul>
        ) : (
          <p className="journal-empty">
            {searchQuery || startDate || endDate || filterTags.length > 0
              ? "No entries found matching your filters."
              : "No entries yet. Start journaling to track your thoughts."}
          </p>
        )}
      </div>

      {undoToast && (
        <div className="swipe-undo-toast" role="status" aria-live="polite">
          <span>{undoToast.message}</span>
          <button
            type="button"
            onClick={() => {
              undoToast.onUndo();
              setUndoToast(null);
              if (undoTimerRef.current) {
                window.clearTimeout(undoTimerRef.current);
                undoTimerRef.current = null;
              }
            }}
          >
            Undo
          </button>
        </div>
      )}
    </section>
  );
}
