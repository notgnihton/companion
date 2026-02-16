# Biometric Authentication - Quick Reference

## Current State Summary

### ❌ No Authentication
- Zero auth system exists
- All data in localStorage (plaintext JSON)
- No API authentication headers
- Onboarding profile is just a "first-run gate", not real auth

### 🔒 Protected Data (All in localStorage)
1. **Journal entries** (HIGH sensitivity) - personal thoughts, photos
2. **Schedule & deadlines** (MEDIUM) - class schedule, assignments
3. **Habits & goals** (MEDIUM) - behavior patterns
4. **Context state** (LOW) - stress/energy levels
5. **Onboarding profile** (LOW) - name, timezone, preferences

### 📍 Current Entry Point
**File**: `apps/web/src/App.tsx`
```typescript
const [profile, setProfile] = useState<OnboardingProfile | null>(loadOnboardingProfile());

if (!profile) {
  return <OnboardingFlow onComplete={handleOnboardingComplete} />;
}

return <MainApp />;  // ← No auth check here
```

---

## Implementation Plan

### 1️⃣ Add Biometric Enrollment to Onboarding
**File**: `apps/web/src/components/OnboardingFlow.tsx`
- Add checkbox: "Protect my data with Face ID / Touch ID"
- After submit → call WebAuthn if checked
- Save credential ID to localStorage

### 2️⃣ Create Biometric Auth Module
**New File**: `apps/web/src/lib/biometric.ts`
```typescript
export function supportsWebAuthn(): boolean;
export async function enrollBiometric(userName: string): Promise<BiometricCredential>;
export async function authenticateBiometric(credentialId: string): Promise<boolean>;
export function loadBiometricCredential(): BiometricCredential | null;
export function saveBiometricCredential(credential: BiometricCredential): void;
```

### 3️⃣ Create Lock Screen Component
**New File**: `apps/web/src/components/BiometricGate.tsx`
- Shows "Unlock with Face ID" UI
- Calls `authenticateBiometric()` on button click
- Has "Skip this time" option
- Shows errors on failure

### 4️⃣ Add Gate to App Startup
**File**: `apps/web/src/App.tsx`
```typescript
const [biometricUnlocked, setBiometricUnlocked] = useState(false);
const biometricCredential = loadBiometricCredential();
const requiresBiometric = profile?.biometricEnabled && biometricCredential && !biometricUnlocked;

if (!profile) {
  return <OnboardingFlow />;
}

if (requiresBiometric) {
  return <BiometricGate onUnlock={() => setBiometricUnlocked(true)} />;  // ← NEW
}

return <MainApp />;
```

---

## Key WebAuthn Concepts

### Enrollment (One-Time Setup)
```typescript
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: randomBytes(32),
    rp: { name: "Companion PWA", id: window.location.hostname },
    user: { id: userNameBytes, name: userName, displayName: userName },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" },   // ES256 (iPhone)
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",  // Forces Face ID/Touch ID
      userVerification: "required",
    },
  },
});

// Save credential.rawId to localStorage
```

### Authentication (Every App Open)
```typescript
const assertion = await navigator.credentials.get({
  publicKey: {
    challenge: randomBytes(32),
    allowCredentials: [{ id: credentialId, type: "public-key" }],
    userVerification: "required",
  },
});

// If assertion !== null → Face ID success
```

---

## Files to Create/Modify

### New Files
- `apps/web/src/lib/biometric.ts` - WebAuthn logic
- `apps/web/src/components/BiometricGate.tsx` - Lock screen
- `apps/web/src/components/SecuritySettings.tsx` - Settings panel (optional)

### Files to Modify
- `apps/web/src/types.ts` - Add `BiometricCredential` interface
- `apps/web/src/lib/storage.ts` - Add biometric credential storage functions
- `apps/web/src/components/OnboardingFlow.tsx` - Add enrollment checkbox
- `apps/web/src/App.tsx` - Add biometric gate check
- `apps/web/src/index.css` - Add lock screen styles
- `docs/project-brief.md` - Update roadmap status

---

## iPhone Considerations

### ✅ Supported
- Safari 14+ (iOS 14+)
- Face ID and Touch ID
- Works in PWA standalone mode

### 🚨 Limitations
- Credentials tied to domain (can't transfer)
- No cross-device sync
- User must re-enroll on each device
- Can't programmatically delete credentials

### Best Practices
- Make biometric **optional** during onboarding
- Always provide "Skip this time" button
- Show clear error messages
- Don't break app if biometric fails

---

## Testing Checklist

- [ ] Enrollment works on iPhone Safari
- [ ] Face ID prompt shows on lock screen
- [ ] Authentication succeeds with Face ID
- [ ] "Skip this time" allows access
- [ ] Settings allow disable/re-enroll
- [ ] Works in PWA mode (Add to Home Screen)
- [ ] Graceful fallback if WebAuthn unsupported
- [ ] Doesn't break push notifications
- [ ] Doesn't break offline journal sync
- [ ] App reopens → requires Face ID again

---

## Quick Start

1. Read full analysis: `docs/auth-biometric-analysis.md`
2. Start with `lib/biometric.ts` implementation
3. Test enrollment on real iPhone
4. Build `BiometricGate.tsx` component
5. Integrate into `App.tsx` startup flow
6. Add settings to enable/disable
7. Update project brief roadmap

**Time Estimate**: 4-6 hours for MVP
