# AXIS Project Brief (Polished)

## Product Statement

Build a personal web app called **AXIS** that acts as a proactive AI companion for day-to-day life management.

## Primary Goals

- Centralize notes, lecture planning, assignments, nutrition, and social highlights.
- Run specialized agents in parallel under one orchestrator.
- Push useful reminders and daily summaries automatically.
- Deliver a morning/evening digest, including a short video summary of social highlights.

## Experience Constraints

- AXIS is a personal app, not for App Store launch.
- It must run as a mobile-friendly web app and be launchable from iPhone Shortcuts/Home Screen.
- UX should be encouraging and low-friction, not nagging.

## Agent Modules

1. Notes Agent
2. Lecture Plan Agent
3. Assignment Tracker Agent
4. Food Tracking Agent
5. Social Media Highlights Agent
6. Video Editor Agent
7. Orchestrator Agent

## Technical Requirements

- Stateful agents with memory.
- Tool-using agents (APIs, file readers, scrapers where legal and compliant).
- Structured message passing with source/type/priority/timestamp.
- Async parallel execution with centralized conflict resolution.
- User-controlled data and privacy-first defaults.

## Success Criteria

- No missed assignment deadlines or lecture reminders.
- Social digest consumable in under 3 minutes.
- Autonomous operation after setup with minimal manual intervention.
