---
description: Check whether this task changed the system design, and write a chat-infra handoff if so
---
Review what changed in this task (`git diff` against the default branch, plus anything decided in this
conversation). Then decide whether it affects the **shared system design**:

- what the app does or how it talks to the services (endpoints used, auth flow, token handling)
- a contract between the app and a service (tokens, WebSocket messages, error codes, API conventions)
- secrets, hosts, builds/releases, costs
- conventions every repo follows
- a decision, phase or step status in PLAN.md

The shared docs are `docs/ARCHITECTURE.md` and `docs/PLAN.md` in **chat-infra**, readable here in
`.context/chat-infra/` (a clone kept up to date by the SessionStart hook). **Do not edit, commit or push in
`.context/chat-infra`** and do not open chat-infra PRs: the owner runs a separate chat-infra session for that.

If nothing is affected, say so in one line and stop.

Otherwise write a handoff file in your scratchpad (e.g. `chat-infra-handoff-<topic>.md`) for the chat-infra
session, in the same shape as earlier ones:
1. A title line ("Handoff from mobile-app: <what>"), the branch name to use (`design/<topic>`), and when to
   merge (usually: after this repo's change is merged, so "live" stays true).
2. Numbered, exact edits per file (section, old wording → new wording), including a PLAN.md change-log row.
3. What to report back (the PR link, and any diff the owner should see).
Then tell the owner the file's full path.
