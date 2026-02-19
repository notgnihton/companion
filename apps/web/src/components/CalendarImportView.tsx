import { useMemo, useState } from "react";
import { applyCalendarImport, previewCalendarImport } from "../lib/api";
import { CalendarImportPayload, CalendarImportPreview, CalendarImportResult } from "../types";

interface CalendarImportViewProps {
  onImported?: () => void;
}

export function CalendarImportView({ onImported }: CalendarImportViewProps): JSX.Element {
  const [ics, setIcs] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null);
  const [result, setResult] = useState<CalendarImportResult | null>(null);

  const payload = useMemo<CalendarImportPayload | null>(() => {
    const trimmedIcs = ics.trim();
    const trimmedUrl = url.trim();

    if (!trimmedIcs && !trimmedUrl) {
      return null;
    }

    return {
      ...(trimmedIcs ? { ics: trimmedIcs } : {}),
      ...(trimmedUrl ? { url: trimmedUrl } : {})
    };
  }, [ics, url]);

  const handlePreview = async (): Promise<void> => {
    if (!payload) {
      return;
    }

    setBusy(true);
    setError("");
    setResult(null);

    try {
      const response = await previewCalendarImport(payload);
      setPreview(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar preview failed.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (): Promise<void> => {
    if (!payload) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await applyCalendarImport(payload);
      setResult(response);
      setPreview(null);
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar import failed.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel calendar-import-panel">
      <header className="panel-header">
        <h2>Calendar Import</h2>
      </header>
      <p className="calendar-import-help">Paste ICS text or add a calendar URL, preview it, then import.</p>
      <div className="calendar-import-fields">
        <label>
          ICS URL
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.edu/calendar.ics"
            disabled={busy}
          />
        </label>
        <label>
          ICS Text
          <textarea
            value={ics}
            onChange={(event) => setIcs(event.target.value)}
            placeholder="BEGIN:VCALENDAR..."
            rows={6}
            disabled={busy}
          />
        </label>
      </div>
      <div className="calendar-import-actions">
        <button type="button" onClick={() => void handlePreview()} disabled={busy || !payload}>
          {busy ? "Working..." : "Preview"}
        </button>
        <button type="button" onClick={() => void handleImport()} disabled={busy || !payload}>
          {busy ? "Working..." : "Import"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {preview && (
        <div className="calendar-import-result">
          <p>
            Preview: {preview.importedEvents} events ({preview.lecturesPlanned} lectures, {preview.deadlinesPlanned}{" "}
            deadlines)
          </p>
          <ul>
            {preview.lectures.slice(0, 3).map((lecture) => (
              <li key={`${lecture.title}-${lecture.startTime}`}>
                Lecture: {lecture.title} ({new Date(lecture.startTime).toLocaleString(undefined, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false
                })})
              </li>
            ))}
            {preview.deadlines.slice(0, 3).map((deadline) => (
              <li key={`${deadline.task}-${deadline.dueDate}`}>
                Deadline: {deadline.task} ({new Date(deadline.dueDate).toLocaleString(undefined, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false
                })})
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <p className="calendar-import-result">
          Imported {result.importedEvents} events ({result.lecturesCreated} lectures, {result.deadlinesCreated}{" "}
          deadlines).
        </p>
      )}
    </section>
  );
}
