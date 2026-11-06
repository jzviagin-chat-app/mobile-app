# mobile-app

The chat app for phones: Expo / React Native + TypeScript. Part of the chat system in GitHub org
`jzviagin-chat-app`; the system design (services, contracts, phases) lives in
[chat-infra/docs](https://github.com/jzviagin-chat-app/chat-infra/tree/main/docs).

**This is the real app, not a throwaway demo.** It starts with only the login flow, but its structure is the
foundation for everything that comes later (chats, WebSocket, local message store, media, push, E2E).

## Status
Empty. Step 1 is to agree the app's design with the owner (see `CLAUDE.md`), then build the skeleton.

## Talks to
- **auth-service**, public: `https://jzviagin-chat-app.129-159-150-34.sslip.io/auth/...`
  (sign-up/login by SMS code, register, token refresh, logout, devices; contract in chat-infra
  `docs/ARCHITECTURE.md` §5 and auth-service `README.md`).
- Later: **chat-service** over WebSocket (`wss://<host>/ws`, phase 9).
