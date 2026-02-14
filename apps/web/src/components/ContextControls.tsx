import { useState } from "react";
import { updateContext } from "../lib/api";
import { UserContext } from "../types";

interface ContextControlsProps {
  onUpdated: () => Promise<void>;
}

const defaults: UserContext = {
  stressLevel: "medium",
  energyLevel: "medium",
  mode: "balanced"
};

export function ContextControls({ onUpdated }: ContextControlsProps): JSX.Element {
  const [payload, setPayload] = useState<UserContext>(defaults);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await updateContext(payload);
      await onUpdated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Context</h2>
      </header>
      <div className="control-grid">
        <label>
          Stress
          <select
            value={payload.stressLevel}
            onChange={(event) => setPayload((prev) => ({ ...prev, stressLevel: event.target.value as UserContext["stressLevel"] }))}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Energy
          <select
            value={payload.energyLevel}
            onChange={(event) => setPayload((prev) => ({ ...prev, energyLevel: event.target.value as UserContext["energyLevel"] }))}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Mode
          <select
            value={payload.mode}
            onChange={(event) => setPayload((prev) => ({ ...prev, mode: event.target.value as UserContext["mode"] }))}
          >
            <option value="focus">Focus</option>
            <option value="balanced">Balanced</option>
            <option value="recovery">Recovery</option>
          </select>
        </label>
      </div>
      <button type="button" onClick={() => void submit()} disabled={busy}>
        {busy ? "Updating..." : "Apply Context"}
      </button>
    </section>
  );
}
