/**
 * Detects if the user is on iOS Safari
 */
export function isIOSSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebkit = /WebKit/.test(ua);
  const isChrome = /CriOS|Chrome/.test(ua);

  // iOS Safari is iOS + WebKit but NOT Chrome
  return isIOS && isWebkit && !isChrome;
}

/**
 * Detects if the app is running in standalone mode (installed to home screen)
 */
export function isStandalone(): boolean {
  // Check for iOS standalone mode
  if ('standalone' in window.navigator) {
    return (window.navigator as { standalone?: boolean }).standalone === true;
  }

  // Check for display-mode: standalone (works on Android and other browsers)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }

  return false;
}

/**
 * Determines if the install prompt should be shown
 * Shows only on iOS Safari when NOT in standalone mode
 */
export function shouldShowInstallPrompt(): boolean {
  return isIOSSafari() && !isStandalone();
}

/**
 * Check if the install prompt has been dismissed by the user
 */
export function isInstallPromptDismissed(): boolean {
  try {
    return localStorage.getItem('install-prompt-dismissed') === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark the install prompt as dismissed
 */
export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem('install-prompt-dismissed', 'true');
  } catch {
    // Silently fail if localStorage is not available
  }
}
