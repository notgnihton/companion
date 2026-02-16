# Biometric Authentication Analysis for Companion PWA

**Date**: 2024
**Feature**: WebAuthn / Face ID / Touch ID Integration
**Status**: Pre-implementation Analysis

---

## Executive Summary

The Companion PWA currently has **no authentication system**. All data is stored in localStorage without any protection mechanism. This analysis outlines the current state and provides specific recommendations for implementing Web Authentication API (WebAuthn) for biometric authentication on iPhone.

---

## 1. Current Authentication State

### ❌ No Authentication Layer

**Finding**: The app has zero authentication mechanisms.

- No login/logout flow
- No user accounts or sessions
- No API authentication headers
- No server-side user identification
- No credential storage

**Code Evidence**:
```typescript
// apps/web/src/lib/api.ts
async function jsonOrThrow<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init  // ← No auth headers added
  });
  // ...
}
```

### Current "Session" Management

The app uses a **local-only onboarding profile** stored in localStorage:

```typescript
// apps/web/src/lib/storage.ts
export function loadOnboardingProfile(): OnboardingProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.onboarding);
    if (raw) {
      return JSON.parse(raw) as OnboardingProfile;
    }
  } catch {
    // ignore corrupted data
  }
  return null;
}
```

**Profile Structure** (`types.ts`):
```typescript
export interface OnboardingProfile {
  name: string;
  timezone: string;
  baselineSchedule: string;
  nudgeTone: "gentle" | "balanced" | "direct";
  completedAt: string;
}
```

**Flow**:
1. User opens app → check `loadOnboardingProfile()`
2. If `null` → show `<OnboardingFlow />` component
3. User fills form → `saveOnboardingProfile()` → localStorage
4. App never shows onboarding again (unless localStorage cleared)

**Key Point**: This is just a "first-run gate", not authentication.

---

## 2. Protected Data Inventory

### 🔒 Sensitive Data That Needs Protection

All data is stored **client-side in localStorage** with these keys:

| Storage Key | Data Type | Sensitivity | Why It Matters |
|-------------|-----------|-------------|----------------|
| `companion:journal` | Journal entries with text, photos, tags | **HIGH** | Personal thoughts, daily reflections, potentially confidential |
| `companion:journal-queue` | Offline journal entries waiting to sync | **HIGH** | Same as above, includes photos as base64 |
| `companion:schedule` | Lecture times and course names | **MEDIUM** | Class schedule reveals routine |
| `companion:deadlines` | Assignment tasks and due dates | **MEDIUM** | Academic workload and progress |
| `companion:habits` | Daily habit check-ins and streaks | **MEDIUM** | Personal behavior patterns |
| `companion:goals` | Goals with motivation notes | **MEDIUM** | Personal aspirations |
| `companion:context` | Stress/energy/mode state | **LOW-MEDIUM** | Emotional state tracking |
| `companion:onboarding` | Name, timezone, preferences | **LOW** | Basic profile info |
| `companion:notification-preferences` | Notification settings | **LOW** | App preferences |

**Most Critical**: Journal entries (including photos). These are highly personal and could contain:
- Private thoughts and feelings
- Photos of whiteboards, notes, or personal documents
- Reflections on relationships, health, academics

**Backend Note**: The server also stores this data in SQLite (`apps/server/data/runtime.db`) after sync, but this analysis focuses on the **client-side PWA**.

### Current Protection: None

Anyone with physical access to the device can:
1. Open the PWA
2. Immediately see all journal entries, deadlines, habits
3. Use browser DevTools → Application → Local Storage → read raw data

**localStorage is NOT encrypted** by the browser. It's plain JSON.

---

## 3. Onboarding Flow Analysis

### Component: `OnboardingFlow.tsx`

**Location**: `apps/web/src/components/OnboardingFlow.tsx`

**Trigger Logic** (in `App.tsx`):
```typescript
const [profile, setProfile] = useState<OnboardingProfile | null>(loadOnboardingProfile());

// ...

if (!profile) {
  return (
    <main className="app-shell">
      <OnboardingFlow onComplete={handleOnboardingComplete} />
    </main>
  );
}
```

**Form Fields**:
1. Name (text input)
2. Timezone (text input, pre-filled with `Intl.DateTimeFormat().resolvedOptions().timeZone`)
3. Baseline schedule (textarea)
4. Nudge tone (select: gentle/balanced/direct)

**Submit Handler**:
```typescript
const handleSubmit = (event: React.FormEvent): void => {
  event.preventDefault();

  if (!name.trim() || !timezone.trim() || !baselineSchedule.trim()) {
    return;
  }

  onComplete({
    name: name.trim(),
    timezone: timezone.trim(),
    baselineSchedule: baselineSchedule.trim(),
    nudgeTone,
    completedAt: new Date().toISOString()
  });
};
```

**No validation beyond "fields not empty"**. No backend call. Just saves to localStorage.

### Key Observation

This is the **perfect place to integrate biometric enrollment**:
- It's a one-time setup flow
- User is already entering personal info
- Natural UX to ask "Protect your data with Face ID?"

---

## 4. Existing Security Patterns

### ✅ What's Good

1. **Offline-First Architecture**: Data stored locally first, synced later
   - Journal entries queued when offline
   - Sync API processes background operations
   - Service worker handles background sync

2. **Data Integrity**: Journal sync includes conflict resolution
   - Client entries have `clientEntryId` and `baseVersion`
   - Server tracks `version` for each entry
   - Conflicts detected and handled (see `/api/journal/sync`)

3. **Service Worker Isolation**: Push notification handling in `public/sw.js`
   - Handles sensitive notification data
   - Tracks interactions (tap/dismiss/action)
   - Never exposes raw data to other origins

4. **No Third-Party Dependencies**: Pure localStorage, no external auth SDKs

### ❌ Security Gaps

1. **No Encryption**: All localStorage data is plaintext JSON
2. **No Authentication**: API calls have no user identification
3. **No Authorization**: Server can't distinguish between users
4. **No Session Management**: No tokens, cookies, or credentials
5. **No Credential Storage**: No place to store biometric registration data
6. **Shared Device Risk**: Anyone can open the PWA and see everything

---

## 5. WebAuthn Integration Recommendations

### 🎯 Implementation Strategy

**Goal**: Add biometric authentication using Web Authentication API (WebAuthn) to protect sensitive journal data on iPhone.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  PWA App Startup                                             │
├─────────────────────────────────────────────────────────────┤
│  1. Check localStorage for onboarding profile               │
│  2. If no profile → Show OnboardingFlow                     │
│  3. If profile exists → Check biometric enrollment          │
│  4. If enrolled → Require biometric unlock                  │
│  5. If not enrolled → Show optional enrollment prompt       │
│  6. After unlock/skip → Show main app                       │
└─────────────────────────────────────────────────────────────┘
```

### Step-by-Step Implementation Plan

#### Phase 1: Add Biometric Enrollment to Onboarding

**File**: `apps/web/src/components/OnboardingFlow.tsx`

**Changes**:
1. Add checkbox: "Protect my data with Face ID / Touch ID"
2. After form submission, if checkbox checked:
   - Call WebAuthn `navigator.credentials.create()`
   - Store credential ID in localStorage
   - Update `OnboardingProfile` interface to include `biometricEnabled: boolean`

**New Type** (add to `types.ts`):
```typescript
export interface BiometricCredential {
  credentialId: string;  // Base64-encoded credential ID from WebAuthn
  publicKey: string;     // Base64-encoded public key (for server verification)
  enrolledAt: string;    // ISO timestamp
}
```

**Updated Type**:
```typescript
export interface OnboardingProfile {
  name: string;
  timezone: string;
  baselineSchedule: string;
  nudgeTone: "gentle" | "balanced" | "direct";
  completedAt: string;
  biometricEnabled?: boolean;  // NEW
}
```

#### Phase 2: Create Biometric Auth Module

**New File**: `apps/web/src/lib/biometric.ts`

**Exports**:
```typescript
export function supportsWebAuthn(): boolean;
export async function enrollBiometric(userName: string): Promise<BiometricCredential>;
export async function authenticateBiometric(credentialId: string): Promise<boolean>;
export function loadBiometricCredential(): BiometricCredential | null;
export function saveBiometricCredential(credential: BiometricCredential): void;
export function clearBiometricCredential(): void;
```

**Key Implementation Notes**:

1. **Feature Detection**:
```typescript
export function supportsWebAuthn(): boolean {
  return window.PublicKeyCredential !== undefined && 
         navigator.credentials !== undefined;
}
```

2. **Enrollment** (called during onboarding):
```typescript
export async function enrollBiometric(userName: string): Promise<BiometricCredential> {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: "Companion PWA",
        id: window.location.hostname,  // Important: must match domain
      },
      user: {
        id: new TextEncoder().encode(userName),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },   // ES256 (iPhone default)
        { alg: -257, type: "public-key" }, // RS256 (fallback)
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",  // Forces Face ID/Touch ID
        userVerification: "required",
      },
      timeout: 60000,
    },
  });
  
  // Extract credential ID and public key
  const credentialId = arrayBufferToBase64(credential.rawId);
  const publicKey = extractPublicKey(credential);  // Helper function needed
  
  return {
    credentialId,
    publicKey,
    enrolledAt: new Date().toISOString(),
  };
}
```

3. **Authentication** (called on app reopen):
```typescript
export async function authenticateBiometric(credentialId: string): Promise<boolean> {
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            id: base64ToArrayBuffer(credentialId),
            type: "public-key",
          },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    });
    
    return assertion !== null;  // If successful, Face ID/Touch ID passed
  } catch (error) {
    console.error("Biometric authentication failed:", error);
    return false;
  }
}
```

**Storage** (add to `storage.ts`):
```typescript
const STORAGE_KEYS = {
  // ... existing keys
  biometric: "companion:biometric",
};

export function loadBiometricCredential(): BiometricCredential | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.biometric);
    if (raw) return JSON.parse(raw) as BiometricCredential;
  } catch {
    // corrupted
  }
  return null;
}

export function saveBiometricCredential(credential: BiometricCredential): void {
  localStorage.setItem(STORAGE_KEYS.biometric, JSON.stringify(credential));
}

export function clearBiometricCredential(): void {
  localStorage.removeItem(STORAGE_KEYS.biometric);
}
```

#### Phase 3: Add Biometric Gate to App

**File**: `apps/web/src/App.tsx`

**New Component**: `<BiometricGate />` (create new file)

**New File**: `apps/web/src/components/BiometricGate.tsx`

```typescript
import { useEffect, useState } from "react";
import { authenticateBiometric, loadBiometricCredential } from "../lib/biometric";

interface BiometricGateProps {
  onUnlock: () => void;
  onSkip: () => void;  // For "Skip this time" option
}

export function BiometricGate({ onUnlock, onSkip }: BiometricGateProps): JSX.Element {
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleUnlock = async (): Promise<void> => {
    setAuthenticating(true);
    setError(null);
    
    const credential = loadBiometricCredential();
    if (!credential) {
      setError("No biometric credential found");
      setAuthenticating(false);
      return;
    }
    
    try {
      const success = await authenticateBiometric(credential.credentialId);
      if (success) {
        onUnlock();
      } else {
        setError("Authentication failed. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAuthenticating(false);
    }
  };
  
  return (
    <section className="panel biometric-gate">
      <header className="panel-header">
        <h2>🔒 Unlock Companion</h2>
      </header>
      <p>Use Face ID / Touch ID to access your journal and data.</p>
      
      {error && <p className="error">{error}</p>}
      
      <div className="button-group">
        <button 
          type="button" 
          onClick={handleUnlock} 
          disabled={authenticating}
          className="primary-button"
        >
          {authenticating ? "Authenticating..." : "Unlock with Face ID"}
        </button>
        
        <button 
          type="button" 
          onClick={onSkip}
          className="secondary-button"
        >
          Skip this time
        </button>
      </div>
    </section>
  );
}
```

**Update `App.tsx`**:
```typescript
import { BiometricGate } from "./components/BiometricGate";
import { loadBiometricCredential } from "./lib/biometric";

export default function App(): JSX.Element {
  const [profile, setProfile] = useState<OnboardingProfile | null>(loadOnboardingProfile());
  const [biometricUnlocked, setBiometricUnlocked] = useState(false);
  
  // ... existing state
  
  // NEW: Check if biometric is required
  const biometricCredential = loadBiometricCredential();
  const requiresBiometric = profile?.biometricEnabled && biometricCredential && !biometricUnlocked;
  
  if (!profile) {
    return (
      <main className="app-shell">
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </main>
    );
  }
  
  // NEW: Show biometric gate if enrolled and not unlocked
  if (requiresBiometric) {
    return (
      <main className="app-shell">
        <BiometricGate 
          onUnlock={() => setBiometricUnlocked(true)}
          onSkip={() => setBiometricUnlocked(true)}  // TODO: Add stricter enforcement
        />
      </main>
    );
  }
  
  // ... rest of app
}
```

#### Phase 4: Add Settings to Manage Biometric

**File**: `apps/web/src/components/AppearanceSettings.tsx` (or create new `SecuritySettings.tsx`)

**New Section**:
```tsx
<section className="panel">
  <header className="panel-header">
    <h2>🔐 Security</h2>
  </header>
  
  <div className="settings-row">
    <label>
      <input 
        type="checkbox" 
        checked={biometricEnabled}
        onChange={handleToggleBiometric}
      />
      Require Face ID / Touch ID on app open
    </label>
  </div>
  
  {biometricEnabled && (
    <button onClick={handleReEnroll}>
      Re-enroll Biometric
    </button>
  )}
</section>
```

---

## 6. Best Places to Add Biometric Check

### 🎯 Recommended Insertion Points

#### 1. **App Startup** (Primary)

**Location**: `apps/web/src/App.tsx` after onboarding check

**Why**: 
- Every app reopen requires unlock
- Protects all views and data
- Consistent with iOS native apps

**When Triggered**:
- User opens PWA from home screen
- User navigates to PWA in browser
- After PWA was backgrounded and returns to foreground

**Implementation**:
```typescript
if (!profile) {
  return <OnboardingFlow />;
}

if (requiresBiometric && !biometricUnlocked) {
  return <BiometricGate />;  // ← NEW
}

return <MainApp />;
```

#### 2. **Journal Entry Creation** (Secondary - Optional)

**Location**: `apps/web/src/components/JournalView.tsx`

**Why**:
- Extra protection for most sensitive action
- Confirms user identity before saving personal thoughts

**When**: Before submitting new journal entry

**UX**: 
- User types journal entry
- Clicks "Save"
- Face ID prompt appears
- After success → entry saved

**Not Recommended**: This adds friction. Better to protect at app level.

#### 3. **Settings Changes** (Tertiary - Optional)

**Location**: When disabling biometric in settings

**Why**: Prevent unauthorized changes to security settings

**When**: User tries to turn off "Require Face ID"

---

## 7. UX Flow Diagrams

### First-Time User Flow

```
┌─────────────────┐
│  Open PWA       │
└────────┬────────┘
         │
         ▼
    ┌────────────────────┐
    │ No profile found?  │
    └────┬───────────────┘
         │ YES
         ▼
    ┌────────────────────┐
    │ OnboardingFlow     │
    │ ┌──────────────┐   │
    │ │ Name         │   │
    │ │ Timezone     │   │
    │ │ Schedule     │   │
    │ │ Nudge Tone   │   │
    │ │              │   │
    │ │ [✓] Protect  │   │  ← NEW: Optional checkbox
    │ │   with Face  │   │
    │ │   ID/Touch   │   │
    │ │   ID         │   │
    │ └──────────────┘   │
    └────┬───────────────┘
         │
         ▼
    ┌────────────────────┐
    │ Checkbox checked?  │
    └────┬───────┬───────┘
         │       │
      YES│       │NO
         │       │
         ▼       ▼
    ┌─────┐  ┌─────┐
    │Call │  │Save │
    │WebA-│  │prof-│
    │uthn │  │ile  │
    │     │  │     │
    │Face │  │Skip │
    │ID   │  │bio  │
    │     │  │     │
    └──┬──┘  └──┬──┘
       │        │
       └────┬───┘
            │
            ▼
    ┌────────────────────┐
    │ Show Main App      │
    └────────────────────┘
```

### Returning User Flow (Biometric Enabled)

```
┌─────────────────┐
│  Open PWA       │
└────────┬────────┘
         │
         ▼
    ┌────────────────────┐
    │ Profile exists?    │
    └────┬───────────────┘
         │ YES
         ▼
    ┌────────────────────┐
    │ Biometric enabled? │
    └────┬───────────────┘
         │ YES
         ▼
    ┌────────────────────┐
    │ BiometricGate      │
    │                    │
    │   🔒 Unlock        │
    │                    │
    │ Use Face ID /      │
    │ Touch ID to access │
    │                    │
    │ [Unlock]  [Skip]   │
    └────┬───────────────┘
         │
         ▼
    ┌────────────────────┐
    │ Face ID Prompt     │  ← Native iOS prompt
    └────┬───────────────┘
         │
         ▼
    ┌────────────────────┐
    │ Success?           │
    └────┬───────┬───────┘
         │       │
      YES│       │NO
         │       │
         ▼       ▼
    ┌─────┐  ┌──────┐
    │Show │  │Show  │
    │Main │  │Error │
    │App  │  │      │
    └─────┘  └──────┘
```

---

## 8. iPhone-Specific Considerations

### ✅ WebAuthn Support on iOS

- **Safari 14+**: Full WebAuthn support (iOS 14+)
- **Face ID**: Works via `authenticatorAttachment: "platform"`
- **Touch ID**: Supported on older iPhones/iPads
- **PWA Context**: WebAuthn works in installed PWAs (standalone mode)

### 🚨 Important Limitations

1. **Domain Binding**: WebAuthn credentials are tied to the domain
   - Current base URL: `/companion/`
   - RP ID must match `window.location.hostname`
   - If deployed to custom domain, credentials won't transfer

2. **No Cross-Device Sync**: 
   - Credentials stored in device's Secure Enclave
   - User must re-enroll on each device
   - Can't backup/restore credentials

3. **User Deletion**: 
   - No API to programmatically delete credentials
   - User must go to iOS Settings → Safari → Advanced → Website Data

4. **Fallback Required**:
   - User might decline Face ID permission
   - Device might not have biometric hardware (rare, but possible)
   - Always provide "Skip this time" or alternative unlock

### Recommended User Messages

**During Onboarding**:
> "Protect your journal with Face ID? Your entries contain personal thoughts and will be encrypted using your device's biometric authentication."

**Biometric Gate**:
> "Unlock Companion with Face ID to access your journal, schedule, and habits."

**If User Declines**:
> "You can enable Face ID protection later in Settings."

**If Device Doesn't Support**:
> "This device doesn't support biometric authentication. Your data is still stored securely on this device."

---

## 9. Data Encryption Strategy

### Current State: No Encryption

localStorage stores data as **plaintext JSON**. Example:

```json
{
  "id": "journal-123",
  "content": "Had a tough day. Talked to therapist about anxiety.",
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```

Anyone with DevTools can read this.

### Recommended: Client-Side Encryption (Future Enhancement)

**Not part of initial biometric implementation**, but consider for Phase 2:

1. **Encryption Key Derivation**:
   - Derive AES-256 key from WebAuthn assertion
   - Store encrypted data in localStorage
   - Decrypt only after successful biometric authentication

2. **Implementation**:
   ```typescript
   import { encrypt, decrypt } from "./lib/crypto";
   
   export function saveJournalEntries(entries: JournalEntry[]): void {
     const encryptedData = encrypt(JSON.stringify(entries), encryptionKey);
     localStorage.setItem(STORAGE_KEYS.journal, encryptedData);
   }
   ```

3. **Challenges**:
   - Key management (where to store the key?)
   - Background sync needs access to decrypted data
   - Service worker can't access encryption key
   - Offline access becomes complex

**Conclusion**: Start with biometric **gate** (authentication), not encryption. Encryption is a significant lift and may not be necessary if biometric gate is enforced.

---

## 10. Testing Checklist

### ✅ Before Submitting PR

- [ ] Feature detection works (old browsers show graceful fallback)
- [ ] Enrollment flow saves credential to localStorage
- [ ] Enrollment failure shows clear error message
- [ ] Biometric gate appears on app reopen
- [ ] Face ID prompt appears and recognizes face
- [ ] Failed authentication shows error and allows retry
- [ ] "Skip this time" button works (doesn't require auth again during same session)
- [ ] Settings allow disabling biometric (after Face ID confirmation)
- [ ] Settings allow re-enrolling biometric
- [ ] Onboarding can be completed without biometric (optional)
- [ ] Existing users (with profile) see prompt to enable biometric
- [ ] Service worker doesn't break (notifications still work)
- [ ] Offline journal entries still queue correctly
- [ ] Background sync still works after auth
- [ ] Multiple devices can enroll separately (each has own credential)

### iPhone-Specific Tests

- [ ] Works in Safari browser
- [ ] Works in installed PWA (Add to Home Screen)
- [ ] Face ID prompt shows correct app name ("Companion PWA")
- [ ] Works with Face ID disabled (shows error, allows skip)
- [ ] Works with Touch ID (older iPhones)
- [ ] App returns to foreground → doesn't re-prompt (session-based unlock)
- [ ] App fully quit + reopened → does re-prompt

---

## 11. Recommended Files to Create/Modify

### New Files

1. **`apps/web/src/lib/biometric.ts`** - Core WebAuthn logic
2. **`apps/web/src/components/BiometricGate.tsx`** - Lock screen
3. **`apps/web/src/components/SecuritySettings.tsx`** - Settings panel (optional, can add to existing)

### Files to Modify

1. **`apps/web/src/types.ts`**
   - Add `BiometricCredential` interface
   - Update `OnboardingProfile` with `biometricEnabled?: boolean`

2. **`apps/web/src/lib/storage.ts`**
   - Add `loadBiometricCredential()`
   - Add `saveBiometricCredential()`
   - Add `clearBiometricCredential()`
   - Add storage key `biometric: "companion:biometric"`

3. **`apps/web/src/components/OnboardingFlow.tsx`**
   - Add checkbox "Protect with Face ID"
   - Add enrollment logic after form submit
   - Handle enrollment errors gracefully

4. **`apps/web/src/App.tsx`**
   - Add biometric gate check after onboarding
   - Manage `biometricUnlocked` state
   - Show `<BiometricGate />` when needed

5. **`apps/web/src/components/AppearanceSettings.tsx`** (or new SecuritySettings)
   - Add biometric enable/disable toggle
   - Add re-enrollment button

6. **`apps/web/src/index.css`**
   - Add styles for `.biometric-gate` panel
   - Add styles for lock icon and buttons

7. **`docs/project-brief.md`**
   - Update roadmap: change `biometric-authentication` from `⬜ todo` to `✅ done` after implementation

---

## 12. Out of Scope (Do NOT Implement)

These are explicitly **not part of this feature**:

- ❌ Server-side authentication API
- ❌ User accounts or multi-user support
- ❌ Password login as alternative
- ❌ Client-side data encryption (localStorage encryption)
- ❌ Credential sync across devices
- ❌ Backend credential storage/verification
- ❌ OAuth / SSO integration
- ❌ Biometric authentication for API calls (all API calls remain unauthenticated)

**Why**: The app is a personal PWA for a single user on a single device. Biometric auth is just a local lock screen, not a multi-user authentication system.

---

## 13. Summary of Recommendations

### 🎯 Implementation Priority

**Phase 1** (MVP - Do This First):
1. Create `lib/biometric.ts` with WebAuthn enrollment and authentication
2. Add optional biometric enrollment to `OnboardingFlow.tsx`
3. Create `BiometricGate.tsx` lock screen component
4. Update `App.tsx` to show gate when biometric is enabled
5. Test on iPhone in PWA mode

**Phase 2** (Polish):
1. Add biometric settings panel (enable/disable/re-enroll)
2. Improve error messages and UX
3. Add analytics (track adoption rate)
4. Add "forgot Face ID" fallback (reset profile)

**Phase 3** (Advanced - Optional):
1. Encrypt localStorage data with key derived from WebAuthn assertion
2. Add biometric re-authentication for sensitive actions (e.g., disabling biometric)
3. Add inactivity timeout (lock after 15 minutes)

### 🚨 Critical Success Factors

1. **Keep it optional** - Don't force users to enable biometric
2. **Graceful degradation** - App must work on devices without WebAuthn
3. **Clear UX** - Users must understand what biometric protects
4. **Session-based** - Don't re-prompt on every navigation, only on app restart
5. **Test thoroughly** - iPhone WebAuthn has quirks, test on real device

### ✅ Definition of Done

Feature is complete when:
- [ ] New users can optionally enable Face ID during onboarding
- [ ] Returning users with Face ID enabled see lock screen on app open
- [ ] Face ID authentication successfully unlocks the app
- [ ] Failed authentication shows error and allows retry
- [ ] "Skip this time" allows temporary access
- [ ] Settings allow enabling/disabling biometric
- [ ] Feature works on iPhone in PWA mode
- [ ] Feature gracefully degrades on unsupported browsers
- [ ] Project brief updated with ✅ done status
- [ ] No regressions in existing features (push notifications, sync, journal, etc.)

---

## 14. Code Review Checklist

When reviewing the implementation PR, verify:

- [ ] No hardcoded credentials or keys
- [ ] Error messages don't leak sensitive info
- [ ] WebAuthn challenge is cryptographically random
- [ ] Credential ID is properly encoded/decoded (Base64)
- [ ] localStorage keys follow existing naming convention (`companion:*`)
- [ ] TypeScript types are exported from `types.ts`, not inline
- [ ] Components follow existing patterns (small, focused, typed props)
- [ ] No new dependencies added (use native Web APIs)
- [ ] CSS follows existing minimal style (no framework bloat)
- [ ] Feature is iPhone PWA-first (tested in Safari standalone mode)
- [ ] Works offline (doesn't break existing offline-first architecture)
- [ ] Service worker still works (no conflicts with WebAuthn)
- [ ] Console has no WebAuthn-related errors
- [ ] DevTools shows credential stored in localStorage correctly

---

**End of Analysis**

This document provides a complete understanding of the current state and a clear path forward for implementing biometric authentication in the Companion PWA.
