# Dev Environment Guide

## Prerequisites

- Node.js 20+
- npm 10+
- VSCode

## Recommended VSCode Extensions

- ESLint
- Prettier
- GitHub Copilot Chat
- TypeScript and JavaScript Language Features

## Start AXIS

```bash
npm install
npm run dev
```

- Web UI: `http://localhost:5173`
- API: `http://localhost:8787`

## iPhone Shortcut Launch

1. Deploy AXIS to HTTPS URL.
2. On iPhone, open Shortcuts and create: `Open URLs -> https://your-axis-url`.
3. Add shortcut to Home Screen and set icon.
4. Optional: open in Safari once, then `Share -> Add to Home Screen`.

## Working With Multiple Coding Agents

1. Put assignment in an issue with explicit path ownership.
2. Tag one agent owner (`Codex`, `Claude`, or `Copilot`).
3. Ensure PR includes `.agents/ORCHESTRATION.md` handoff template fields.
4. Merge backend contracts first, then frontend consumers.
