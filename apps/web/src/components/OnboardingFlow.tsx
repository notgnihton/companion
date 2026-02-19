import { OnboardingProfile } from "../types";

interface OnboardingFlowProps {
  onComplete: (profile: OnboardingProfile) => void;
}

const DEFAULT_TIMEZONE = "Europe/Oslo";
const DEFAULT_NUDGE_TONE: NonNullable<OnboardingProfile["nudgeTone"]> = "balanced";

export function OnboardingFlow({ onComplete }: OnboardingFlowProps): JSX.Element {
  const handleContinue = (event: React.FormEvent): void => {
    event.preventDefault();

    const profile: OnboardingProfile = {
      timezone: DEFAULT_TIMEZONE,
      nudgeTone: DEFAULT_NUDGE_TONE,
      completedAt: new Date().toISOString()
    };
    onComplete(profile);
  };

  return (
    <section className="panel onboarding-panel">
      <header className="panel-header">
        <h2>Welcome to Companion</h2>
      </header>
      <p>Onboarding uses defaults and starts immediately.</p>
      <p className="muted">Timezone defaults to Norway (`Europe/Oslo`) and nudge tone defaults to balanced.</p>
      <form className="onboarding-form" onSubmit={handleContinue}>
        <button type="submit">
          Start using Companion
        </button>
      </form>
    </section>
  );
}
