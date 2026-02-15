import { useEffect, useState } from "react";
import { dismissInstallPrompt, isInstallPromptDismissed, shouldShowInstallPrompt } from "../lib/install";

export function InstallPrompt(): JSX.Element | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Check if we should show the prompt
    const show = shouldShowInstallPrompt() && !isInstallPromptDismissed();
    setVisible(show);
  }, []);

  const handleDismiss = (): void => {
    dismissInstallPrompt();
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="install-prompt">
      <div className="install-prompt-content">
        <h3>Install Companion</h3>
        <p>
          Add Companion to your home screen for the best experience with push notifications and offline access.
        </p>
        <ol className="install-instructions">
          <li>
            Tap the <strong>Share</strong> button{" "}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              style={{ display: "inline", verticalAlign: "middle" }}
            >
              <path d="M8 0.5L8 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M4.5 7L8 3.5L11.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M2 11.5L2 14.5C2 14.7761 2.22386 15 2.5 15L13.5 15C13.7761 15 14 14.7761 14 14.5L14 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>{" "}
            in Safari's toolbar
          </li>
          <li>
            Scroll down and tap <strong>"Add to Home Screen"</strong>
          </li>
          <li>Tap <strong>Add</strong> to confirm</li>
        </ol>
        <button type="button" onClick={handleDismiss} className="dismiss-button">
          Got it
        </button>
      </div>
    </div>
  );
}
