# Onboarding & Promotional Video Roadmap

## Current State

Onboarding was simplified to a **one-tap start** (fixed defaults: `Europe/Oslo`, balanced tone). There is no multi-screen onboarding flow and no promotional video.

---

## Part 1: Onboarding Flow

### Goal
A 3-4 screen swipeable welcome flow shown on first launch. Introduces the core value props before the user lands in Chat.

### Screen Design

| Screen | Content | Visual |
|--------|---------|--------|
| **1 — Welcome** | "Hey! I'm your AI companion for university." | App icon (chat bubble + sparkles) centered, dark gradient bg |
| **2 — Smart Schedule** | "I know your lectures, deadlines, and exams." | Screenshot/mockup of Schedule tab with real course data |
| **3 — Chat Anything** | "Ask me about assignments, plan your week, or just vent." | Screenshot of a chat conversation with Gemini response |
| **4 — Get Started** | "Let's go!" + CTA button | Subtle confetti or sparkle animation, single "Start" button |

### Implementation Plan

```
apps/web/src/components/OnboardingFlow.tsx   ← NEW
apps/web/src/index.css                       ← add .onboarding-* styles
apps/web/public/onboarding/                  ← feature images (PNG/WebP)
```

**Component structure**:
```tsx
function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const screens = [WelcomeScreen, ScheduleScreen, ChatScreen, GetStartedScreen];
  // Swipe gesture or dot navigation
  // On last screen CTA → localStorage.set("onboarding-done", "1") → onComplete()
}
```

**Show condition** in `App.tsx`:
```tsx
const needsOnboarding = !localStorage.getItem("onboarding-done");
if (needsOnboarding) return <OnboardingFlow onComplete={() => setOnboarded(true)} />;
```

### Feature Images

**What you need to provide**:
- 3 images (screens 2-4), **390×844px** (iPhone 14 Pro viewport)
- Format: **WebP** (best) or PNG with transparency
- Place in `apps/web/public/onboarding/`
- Naming: `schedule-preview.webp`, `chat-preview.webp`, `get-started.webp`

**How to create them**:
1. **Screenshots** — Run the app on mobile (or Chrome DevTools → iPhone 14 Pro), take screenshots of the Schedule and Chat tabs with realistic data
2. **Figma/Canva** — Design polished versions with annotations (arrows, highlights)
3. **AI generation** — Use a tool like Midjourney/DALL-E for stylized illustrations (though screenshots feel more authentic for a personal app)

**Recommended approach**: Take real screenshots, then crop to show just the relevant portion (e.g., the schedule card area, a chat conversation). Add a subtle phone frame mockup if desired.

### Swipe Gesture

Use CSS scroll-snap for buttery smooth swiping:
```css
.onboarding-container {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}
.onboarding-screen {
  flex: 0 0 100vw;
  scroll-snap-align: center;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}
```

### Dot Navigation

Small dots at the bottom showing current position. Tapping a dot jumps to that screen. The last screen replaces dots with a prominent "Get Started" button.

---

## Part 2: Promotional Video / Animation

### Purpose
A 30-60 second video for:
- App Store / Google Play listing (if published)
- GitHub README hero section
- Social media / portfolio showcase

### Storyboard (30 seconds)

| Time | Scene | Audio/Caption |
|------|-------|------|
| 0-5s | App icon zooms in, sparkle animation | "Meet Companion" |
| 5-12s | Phone mockup showing Chat tab → user types "what's due this week?" → AI responds with deadline list | "Ask anything about your courses" |
| 12-18s | Swipe to Schedule tab → shows today's lectures with times and rooms | "Your full schedule, always up to date" |
| 18-24s | Swipe to Growth tab → analytics rings fill up, streak counter animates | "Track your habits and growth" |
| 24-30s | Quick montage: deadline notification, meal logging, focus timer → end on app icon + tagline | "Companion — your AI study buddy" |

### How to Create It

**Option A: Screen Recording + Editing (Recommended, free)**
1. Run the app in Chrome DevTools (iPhone 14 Pro frame)
2. Use OBS or macOS Screen Recording to capture interactions
3. Edit in DaVinci Resolve (free) or CapCut (free, mobile)
4. Add captions, transitions, and background music
5. Export as MP4 (1080×1920 for vertical, 1920×1080 for landscape)

**Option B: Motion Design (high polish)**
1. Design screens in Figma
2. Import to After Effects / Rive / Lottie for animations
3. More work but much more polished result

**Option C: AI Video Tools**
1. Take screenshots of each tab
2. Use Runway ML, Pika, or HeyGen to generate transitions
3. Quick turnaround but less control

### Video Specs

| Platform | Resolution | Duration | Format |
|----------|-----------|----------|--------|
| GitHub README | 1280×720 | 30s | GIF or MP4 |
| App Store | 1080×1920 | 30s | MP4 (H.264) |
| Social media | 1080×1920 (vertical) | 15-60s | MP4 |
| Portfolio site | 1920×1080 | 30-60s | MP4 or WebM |

### Hosting

- **GitHub README**: Use a GIF (< 10MB) or link to YouTube/Vimeo
- **PWA landing page**: Host MP4 on GitHub Releases or a CDN, embed with `<video>` tag
- Don't commit large video files to the repo — use Git LFS or external hosting

---

## Part 3: Implementation Priority

| Priority | Task | Effort | Dependencies |
|----------|------|--------|-------------|
| **P1** | Build `OnboardingFlow.tsx` with 4 screens | 2-3 hours | None |
| **P1** | Take 3 feature screenshots from the live app | 30 min | App running with real data |
| **P2** | Add swipe gestures + dot navigation | 1 hour | OnboardingFlow done |
| **P2** | Screen record a 30s demo video | 1-2 hours | App running with real data |
| **P3** | Polish video with captions + transitions | 2-3 hours | Raw recording |
| **P3** | Add video to GitHub README + landing section | 30 min | Video hosted |

### Task Issues to Create

1. `onboarding-screens` — Create OnboardingFlow component with 4 swipeable screens, CSS scroll-snap, dot navigation, localStorage gate
2. `onboarding-assets` — Take feature screenshots, optimize as WebP, place in `public/onboarding/`
3. `promo-video` — Record and edit 30s promotional video, host externally, embed in README
