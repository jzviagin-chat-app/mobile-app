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
- Never log or display tokens, SMS codes or full phone numbers. Tokens only in secure storage.
- (Stack, layout and the checks to run before every commit: added in step 1, once agreed.)

## Keeping the design current
If a change affects a service, a contract (endpoints, tokens, error codes, WebSocket messages), the infra or a
decision in PLAN.md, run `/sync-design`: it writes a handoff file for the owner's chat-infra session.
**Never edit or push `.context/chat-infra`, and never open chat-infra PRs from this repo.**
Run `/sync-design` before finishing a task.
