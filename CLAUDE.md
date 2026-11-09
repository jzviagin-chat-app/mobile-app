# mobile-app — Claude Code context

The chat app for phones (Expo / React Native + TypeScript). Part of the chat system in GitHub org
`jzviagin-chat-app`; the **system design lives in chat-infra** and is kept in `.context/chat-infra/` by the
SessionStart hook (`.claude/hooks/load-design.sh`).

## System design (shared, loaded from chat-infra)
@.context/chat-infra/docs/ARCHITECTURE.md
@.context/chat-infra/docs/PLAN.md

## This app
@README.md

## Working with the owner
- The owner is a Node.js / TypeScript developer, **new to React and React Native**: explain React concepts
  (components, hooks, state, effects, navigation) with the why, plain examples and trade-offs.
  **Don't guess** facts, versions or UI; say when unsure and check the official docs.
  One step at a time; do only what was asked; explain a step before building it.
- `main` is protected (PRs only, admins included): work on a branch, open a PR; the owner merges.
- Commands for the owner: root-anchored (`cd "$(git rev-parse --show-toplevel)"`) and say which machine
  (Mac / phone).
- **Costs nothing:** no paid services or accounts (Apple developer program, paid EAS plans, …) unless the
  owner decides otherwise.

## Rules for this repo
- This is the foundation of the real app, not a demo: structure, naming and tests as for production.
- Never log or display tokens, SMS codes or full phone numbers. Tokens only in secure storage; the
  registration token only in memory. Log only through `src/lib/log.ts` (`console` is a lint error).
- Expo changes every SDK: check the versioned docs (SDK 58) before using an Expo / React Native API.
  Native packages only with `npx expo install`; never edit `ios/` / `android/` (generated from `app.config.ts`).
- Layers: `src/app` (thin routes) → `src/root` → `src/features/<name>` → `src/lib`, `src/ui`. Never upwards;
  another feature only through its `index.ts`. ESLint enforces it.
- State: screens read only MobX stores (`observer` components). Stores: `makeAutoObservable`, changes only in
  actions, async with `flow`, dependencies through the constructor (never the whole root). Request/reply
  server data via TanStack Query behind a store (`MobxQuery`, README §5); detail screens use per-id models,
  never a global `setId`. Reactions only in stores, disposed in `dispose()`.
- Forms: `useActionState`, dispatched in `startTransition`; actions return errors as state, never throw.
- Styles: theme tokens only (light + dark); `start`/`end`, never `left`/`right`. Texts only via i18n keys,
  in both `locales/he.json` and `locales/en.json`.
- Tests with every change: stores and pure functions unit-tested; screens rendered in he + en, light + dark.
- Docs (`*.md`) are hand-formatted; Prettier skips them.

## Before every commit
```bash
npm run check    # = lint (0 warnings) + prettier --check + tsc --noEmit + jest
```
CI (job `check`) runs the same plus `npm run doctor` and `npx expo export --platform android`; run those too
when dependencies, `app.config.ts` or imports change. Run `git status` first: no `.env*.local`, `ios/`,
`android/`, `dist/` or signing files.

## Keeping the design current
If a change affects a service, a contract (endpoints, tokens, error codes, WebSocket messages), the infra or a
decision in PLAN.md, run `/sync-design`: it writes a handoff file for the owner's chat-infra session.
**Never edit or push `.context/chat-infra`, and never open chat-infra PRs from this repo.**
Run `/sync-design` before finishing a task.
