import { useEffect, useMemo, useState } from "react";
import { getCanvasStatus, previewIntegrationScope, triggerCanvasSync, triggerTPSync } from "../lib/api";
import {
  loadIntegrationScopeSettings,
  saveIntegrationScopeSettings
} from "../lib/storage";
import type { CanvasStatus, IntegrationScopePreview, IntegrationScopeSettings } from "../types";

function parseCourseIds(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function clampPastDays(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(365, Math.round(value)));
}

function clampFutureDays(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(730, Math.round(value)));
}

function normalizeScopeSettings(settings: IntegrationScopeSettings, tpCourseInput: string): IntegrationScopeSettings {
  const canvasCourseIds = Array.from(new Set(settings.canvasCourseIds.filter((id) => Number.isInteger(id) && id > 0)));
  const tpCourseIds = parseCourseIds(tpCourseInput);
  return {
    semester: settings.semester.trim() || "26v",
    tpCourseIds: tpCourseIds.length > 0 ? tpCourseIds : ["DAT520,1", "DAT560,1", "DAT600,1"],
    canvasCourseIds,
    pastDays: clampPastDays(settings.pastDays),
    futureDays: clampFutureDays(settings.futureDays)
  };
}

export function IntegrationScopeSettings(): JSX.Element {
  const [settings, setSettings] = useState<IntegrationScopeSettings>(loadIntegrationScopeSettings());
  const [tpCourseInput, setTPCourseInput] = useState(() => loadIntegrationScopeSettings().tpCourseIds.join("; "));
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({
    baseUrl: "",
    lastSyncedAt: null,
    courses: []
  });
  const [preview, setPreview] = useState<IntegrationScopePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async (): Promise<void> => {
      const status = await getCanvasStatus();
      setCanvasStatus(status);
    };

    void load();
  }, []);

  const selectedCanvasSet = useMemo(() => new Set(settings.canvasCourseIds), [settings.canvasCourseIds]);

  const updateSettings = (next: IntegrationScopeSettings): void => {
    setSettings(next);
    saveIntegrationScopeSettings(next);
  };

  const toggleCanvasCourse = (courseId: number): void => {
    const nextIds = selectedCanvasSet.has(courseId)
      ? settings.canvasCourseIds.filter((id) => id !== courseId)
      : [...settings.canvasCourseIds, courseId];

    updateSettings({
      ...settings,
      canvasCourseIds: nextIds
    });
  };

  const handlePreview = async (): Promise<void> => {
    setPreviewLoading(true);
    setError("");
    setMessage("");

    const normalized = normalizeScopeSettings(settings, tpCourseInput);
    updateSettings(normalized);
    setTPCourseInput(normalized.tpCourseIds.join("; "));

    try {
      const result = await previewIntegrationScope({
        semester: normalized.semester,
        tpCourseIds: normalized.tpCourseIds,
        canvasCourseIds: normalized.canvasCourseIds,
        pastDays: normalized.pastDays,
        futureDays: normalized.futureDays
      });
      setPreview(result);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Failed to load scope preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    setApplyLoading(true);
    setError("");
    setMessage("");

    const normalized = normalizeScopeSettings(settings, tpCourseInput);
    updateSettings(normalized);
    setTPCourseInput(normalized.tpCourseIds.join("; "));

    const [canvasResult, tpResult] = await Promise.all([
      triggerCanvasSync(undefined, {
        courseIds: normalized.canvasCourseIds,
        pastDays: normalized.pastDays,
        futureDays: normalized.futureDays
      }),
      triggerTPSync({
        semester: normalized.semester,
        courseIds: normalized.tpCourseIds,
        pastDays: normalized.pastDays,
        futureDays: normalized.futureDays
      })
    ]);

    if (canvasResult.success && tpResult.success) {
      setMessage("Scope applied and integrations synced.");
    } else {
      const errors = [canvasResult.error, tpResult.error].filter(Boolean);
      setError(errors.join(" | ") || "Scope apply completed with errors.");
    }

    const latestCanvasStatus = await getCanvasStatus();
    setCanvasStatus(latestCanvasStatus);

    try {
      const result = await previewIntegrationScope({
        semester: normalized.semester,
        tpCourseIds: normalized.tpCourseIds,
        canvasCourseIds: normalized.canvasCourseIds,
        pastDays: normalized.pastDays,
        futureDays: normalized.futureDays
      });
      setPreview(result);
    } catch {
      // Non-blocking: sync has already completed.
    } finally {
      setApplyLoading(false);
    }
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Integration scope</h2>
      </header>

      <div className="settings-stack">
        <label>
          TP semester
          <input
            type="text"
            value={settings.semester}
            onChange={(event) => updateSettings({ ...settings, semester: event.target.value })}
            placeholder="26v"
          />
        </label>

        <label>
          TP course IDs
          <textarea
            value={tpCourseInput}
            onChange={(event) => {
              setTPCourseInput(event.target.value);
              updateSettings({ ...settings, tpCourseIds: parseCourseIds(event.target.value) });
            }}
            rows={2}
            placeholder="DAT520,1; DAT560,1; DAT600,1"
          />
          <p className="muted">Separate course IDs using comma, semicolon, or new line.</p>
        </label>

        <div className="panel">
          <header className="panel-header">
            <h3>Canvas course scope</h3>
            <p className="muted">{settings.canvasCourseIds.length} selected</p>
          </header>

          {canvasStatus.courses.length === 0 ? (
            <p className="muted">No Canvas courses available yet. Run Canvas sync first.</p>
          ) : (
            <>
              <div className="panel-header">
                <button
                  type="button"
                  onClick={() => updateSettings({ ...settings, canvasCourseIds: canvasStatus.courses.map((course) => course.id) })}
                >
                  Select all
                </button>
                <button type="button" onClick={() => updateSettings({ ...settings, canvasCourseIds: [] })}>
                  Clear
                </button>
              </div>
              <ul className="list">
                {canvasStatus.courses.map((course) => (
                  <li key={course.id} className="list-item">
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedCanvasSet.has(course.id)}
                        onChange={() => toggleCanvasCourse(course.id)}
                      />
                      {" "}
                      {course.course_code} - {course.name}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="panel-header">
          <label>
            Past days
            <input
              type="number"
              min={0}
              max={365}
              value={settings.pastDays}
              onChange={(event) =>
                updateSettings({ ...settings, pastDays: clampPastDays(Number(event.target.value)) })
              }
            />
          </label>
          <label>
            Future days
            <input
              type="number"
              min={1}
              max={730}
              value={settings.futureDays}
              onChange={(event) =>
                updateSettings({ ...settings, futureDays: clampFutureDays(Number(event.target.value)) })
              }
            />
          </label>
        </div>

        <div className="panel-header">
          <button type="button" onClick={() => void handlePreview()} disabled={previewLoading || applyLoading}>
            {previewLoading ? "Loading preview..." : "Preview scope"}
          </button>
          <button type="button" onClick={() => void handleApply()} disabled={applyLoading}>
            {applyLoading ? "Applying..." : "Apply + sync now"}
          </button>
        </div>

        {message && <p>{message}</p>}
        {error && <p className="error">{error}</p>}

        {preview && (
          <div className="panel">
            <header className="panel-header">
              <h3>Scope preview</h3>
            </header>
            <p>
              Canvas courses: {preview.canvas.coursesMatched} / {preview.canvas.coursesTotal}
            </p>
            <p>
              Canvas assignments in window: {preview.canvas.assignmentsMatched} / {preview.canvas.assignmentsTotal}
            </p>
            <p>
              TP events in window: {preview.tp.eventsMatched} / {preview.tp.eventsTotal}
            </p>
            <p className="muted">
              Window: {preview.window.start} to {preview.window.end}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
