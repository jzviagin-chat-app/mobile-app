# mobile-app

**Walkie Talkie**, the chat app for phones: Expo / React Native + TypeScript. Part of the chat system in
GitHub org `jzviagin-chat-app`; the system design (services, contracts, phases) lives in
[chat-infra/docs](https://github.com/jzviagin-chat-app/chat-infra/tree/main/docs).

**This is the real app, not a throwaway demo.** It starts with only the login flow, but its structure is the
foundation for everything that comes later (chats over WebSocket, local message store, media, push, E2E).

> **Status: skeleton (phase 8 step 1).** Boots to an empty "logged out" screen in Hebrew or English,
> light or dark, following the phone. Lint, types, tests and CI in place. Next: login (step 2).

---

## Contents
1. [Where it fits](#1-where-it-fits)
2. [Technology choices](#2-technology-choices)
3. [Running it on a phone](#3-running-it-on-a-phone)
4. [Project layout](#4-project-layout)
5. [State and data: MobX in front, TanStack Query behind](#5-state-and-data-mobx-in-front-tanstack-query-behind)
6. [Navigation and the session](#6-navigation-and-the-session)
7. [API client and tokens (steps 2–3)](#7-api-client-and-tokens-steps-23)
8. [Language, right-to-left, light and dark](#8-language-right-to-left-light-and-dark)
9. [Configuration](#9-configuration)
10. [Rules](#10-rules)
11. [Everyday commands](#11-everyday-commands)
12. [Build plan](#12-build-plan)

---

## 1. Where it fits

```
 Walkie Talkie (this app) ──HTTPS──► HAProxy ingress ──/auth/*──► auth-service   (login, tokens, devices)
                          ──WSS /ws─►                ──/*──────► chat-service   (phase 9: messages)
```
- **auth-service** (live): sign-up/login by SMS code, register, token refresh, logout, devices. Contract:
  chat-infra `docs/ARCHITECTURE.md` §5 and the auth-service README (API, flows, error codes).
- **chat-service** (phase 9): one WebSocket per device, messages stored in a local SQLite inbox with a cursor
  and cumulative acks (chat-infra `PLAN.md` §4, phase 9 "Client side").

## 2. Technology choices

Every native package is added with **`npx expo install <pkg>`** (not `npm install`): it picks the version
tested with our Expo SDK, like a curated lockfile. `npm run doctor` checks it.

| Concern | Choice | Node.js / web equivalent | Why |
|---|---|---|---|
| Framework | **Expo SDK 58** (React Native 0.88, React 19.3, Hermes) | – | Current SDK (2026-09-29); Expo's modules, config plugins and tooling on top of React Native |
| Runtime | **Development build** (`expo-dev-client`), never Expo Go | Your own binary vs a shared sandbox app | Expo Go can't run our own native code; we'll need it (RTL forcing, push, crypto for the device keypair) |
| Native code | npm libraries with native code, **local Expo modules** (`npx create-expo-module --local` → `modules/`), config plugins | Native addons (N-API) | Full native access when needed; `ios/` and `android/` are generated (CNG), config lives in `app.config.ts` |
| Language | **TypeScript 6.0** `strict` + `noUncheckedIndexedAccess` | same | Version pinned by the SDK 58 template |
| Packages | **npm**, Node **24 LTS** (`.nvmrc`) | same | Fewest surprises with Metro and autolinking |
| Bundler | **Metro** (via Expo CLI) | webpack / Vite | Required by React Native; hot reload over USB/Wi-Fi |
| Navigation | **Expo Router** (file-based, on React Navigation 7) | Next.js app router | Files are routes; typed routes; deep links (QR linking later); `Stack.Protected` for auth |
| App state | **MobX 7** + `mobx-react-lite` | A class with an EventEmitter, but automatic | Observable stores; components re-render only for what they read; usable outside React |
| Server data | **TanStack Query core** behind MobX stores (§5) | react-query / SWR | Caching, dedup, refetching, retries without writing them ourselves |
| Form submits | React 19 **`useActionState`** | – | Pending + result state for a submit, built into React |
| API client | `openapi-typescript` + `openapi-fetch` (step 2) | axios instance + interceptors, types from OpenAPI | Typed paths and bodies from auth-service's schema |
| Secure storage | **expo-secure-store** (iOS Keychain / Android Keystore) | OS keychain (`keytar`) | Tokens never in AsyncStorage |
| Styling | **`StyleSheet`** + our theme tokens (light + dark) | CSS-in-JS with design tokens | No extra layer to learn; nothing to migrate later |
| i18n | **i18next** + `react-i18next` + **expo-localization** | i18next | The standard; typed keys; follows the phone language |
| Validation | **zod 4** | zod | Config now; API/form edges later |
| Tests | **Jest** (`jest-expo`) + **React Native Testing Library 14** | Jest + React Testing Library | Unit tests and screens rendered in Node |
| Lint / format | **ESLint 9** (`eslint-config-expo`) + **Prettier** | same | Expo's rules + our import layers |
| CI | **GitHub Actions**, job `check` | same | On every PR and on `main` after merge; no app-store builds |

## 3. Running it on a phone

**Costs nothing:** no paid Apple account, no paid EAS plan. The app is built locally on the Mac.

| Device | How | Notes |
|---|---|---|
| **Galaxy S22 Ultra** (main dev phone) | USB debugging on, plug in, `npm run android` | Free, no expiry. First build takes several minutes (Gradle); after that, JS changes hot-reload |
| **iOS simulator** | `npm run ios` | Needs Xcode; free |
| iPhone 6s | ✗ | Can't run SDK 58 apps: Expo's core needs iOS 16.4, the 6s stops at iOS 15 |
| A newer iPhone (later) | `npx expo run:ios --device` with a free Apple ID in Xcode | The app must be rebuilt every 7 days; iOS push needs the paid account |

How it works: `npm run android` (= `expo run:android --device`) generates `android/`, builds a debug APK
with the dev client, installs it and starts **Metro**, the dev server the app loads its JavaScript from. Next
time, if no native package or `app.config.ts` setting changed, just `npm start` and open the app: it
reconnects to Metro. Rebuild (`npm run android`) after adding a native package or changing `app.config.ts`.

Talking to a local auth-service (from step 2): run auth-service locally (its `compose.yaml` + uvicorn, with
`ENVIRONMENT=dev`: fake SMS sender, codes appear in its log, ₪0) and, with the S22 on USB:
`adb reverse tcp:8000 tcp:8000`, so the phone's `localhost:8000` reaches the Mac (see §9).

## 4. Project layout

```
src/
  app/                    Routes only (Expo Router). Thin files: they re-export a feature's screen.
    _layout.tsx           Root: config check, RootStore, providers, the logged-out/logged-in switch
    (auth)/               Logged-out routes. welcome.tsx → /welcome
    (app)/                Logged-in routes. index.tsx → /  (placeholder until step 2)
  root/                   RootStore (creates and wires every store), StoreProvider + useStores(), MobX config
  features/
    auth/                 Everything about login: SessionStore, screens. Public surface: index.ts
                          later: features/devices, features/chats, features/contacts, …
  lib/                    No UI, no stores: config (zod), i18n, log (masking), api/ (step 2)
                          later: lib/query (MobxQuery adapter, step 3)
  ui/                     Theme tokens + shared components (Screen, Text; later Button, TextField)
locales/                  he.json, en.json (same keys; typed)
assets/                   Icons and splash image
app.config.ts             Native config (name, ids, plugins); changing it needs a new native build
```
Reserved for later (not created yet): `src/realtime/` (WebSocket), `src/data/` (SQLite), `modules/` (local
native modules).

**Import layers** (ESLint enforces them): `app` → `root` → `features` → `lib`, `ui`. Never upwards.
Another feature is imported only through its index: `@/features/auth`, never `@/features/auth/…`; inside a
feature use relative paths. Same idea as auth-service's `api/` → `services/` → `db/`.

## 5. State and data: MobX in front, TanStack Query behind

Screens read **only MobX stores**. What's behind a store depends on where the data comes from:

| Data | Lives in | Example |
|---|---|---|
| Client state | MobX store fields | `session.status`, later: connection state, drafts |
| Request/reply server data | TanStack Query's cache, exposed by a store through a `MobxQuery` (step 3) | devices list, profile, contacts |
| Pushed data (phase 9) | MobX stores over SQLite + the WebSocket | chats, messages, typing, online |

**Root store, no singletons.** `RootStore` (`src/root/`) creates the `QueryClient`, i18n and every store,
and passes each store **only what it needs** through its constructor (the API client, token storage, another
store), never the whole root, so features never import `root` (no import cycles). It's created once in
the root layout and given to screens by `StoreProvider`; `useStores()` reads it. Tests build a fresh one with
fakes, like building an Express app per test.

**Stores** are plain classes: `makeAutoObservable(this, {}, { autoBind: true })` in the constructor (no
decorators: MobX 7 supports only standard decorators, which would need extra Babel setup). Fields become
observable, getters become `computed` (cached, recalculated only when what they read changes), methods
become actions. `configure({ enforceActions: "observed" })`: shown state changes only inside actions.
Async actions use `flow` (a generator: `yield` instead of `await`, and state changes after it stay inside
the action).

**Components** that read stores are wrapped in `observer(...)`: MobX tracks what each render read and
re-renders only those components when exactly that changes. Components never use `autorun`.

**Request/reply data: the `MobxQuery` adapter** (step 3, ~40 lines in `src/lib/query/`). TanStack Query is
two layers: `@tanstack/query-core` (cache, dedup, retries, refetching; no React) and adapters like
`useQuery`. A `MobxQuery` holds a core `QueryObserver` and a MobX atom:
- When an `observer` first reads it, it subscribes (fetching if the data is stale); when nothing reads it,
  it unsubscribes. TanStack keeps the data cached for `gcTime`.
- Its options are a function reading observables (e.g. an id). When the query key changes, it calls
  `setOptions`; TanStack serves from cache (fresh: no request; stale: cached now + background refetch) or
  fetches. Each result → the atom reports a change → `computed`s recalculate → only the screens that read
  them re-render.
- Built in: no race between keys (only results for the current key arrive), and an identical refetch
  doesn't re-render (TanStack keeps the same object; MobX compares by reference).

Stores expose **getters** that turn JSON into app models (`devices.list`, `devices.linkedCount`) and
**actions** for writes (`devices.remove(id)` = API call → `invalidateQueries`). We don't use
`mobx-tanstack-query`: niche, and it requires MobX 6.

**Detail screens use per-id models, never a global `setId`.** The route param is the truth (`/users/[id]`):
the screen calls `root.users.byId(id)`, which returns one model per id (kept in a map, removed when nothing
reads it), each with its own query keyed `['user', id]`. With a single shared `setId`, opening user B from
user A and pressing back would show B on A's screen; per-id models keep stacked screens independent and
make deep links work.

**Forms** submit with `useActionState`: the button calls `dispatch` inside `startTransition` (React Native
has no `<form action>`); the action calls a store action and **returns** an error state instead of
throwing (a throw cancels queued actions and reaches the error boundary). No form library until a form needs one.

**Reactions** (code that runs when observables change) are rare: only inside store constructors, disposed in
`dispose()`, for app-wide side effects (signed out → `queryClient.clear()`; later: close the socket).
When the cause is known, call the action directly instead.

## 6. Navigation and the session

Expo Router: **every file under `src/app/` is a route**; `_layout.tsx` wraps its folder (a stack here);
`(group)` folders group routes without adding to the URL. Navigate with `router.push('/…')` (typed: a typo
is a type error).

The root layout reads `session.status` (`loading` → `signedOut` / `signedIn`):
- `loading`: the native splash screen stays up while the session is restored (later: tokens from secure storage).
- `<Stack.Protected guard={session.isSignedIn}>` wraps `(app)`, `<Stack.Protected guard={!session.isSignedIn}>`
  wraps `(auth)`. When the status changes the router switches groups and **removes the other group's history**,
  so "back" can't return to a logged-in screen after sign-out.

**Lazy loading.** On a phone the whole JS bundle (Hermes bytecode) is already in the app; what matters is
that a screen's code doesn't *run* before it's needed. Expo Router gives each route to React Navigation as
`getComponent: () => …` (`expo-router/build/useScreens.js`), which is called the first time the screen
renders; only then is the route file evaluated, and Metro evaluates a module (and its imports) on first
`require`. So routes and their features load lazily without `React.lazy`. (Exception: in development only,
Expo Router loads every route once at startup to warn about missing default exports.) Keep route files thin
anyway: re-export a feature screen.

## 7. API client and tokens (steps 2–3)

Designed now, built with the login:
- **Types** from auth-service's OpenAPI schema with `openapi-typescript` (the schema exists only when
  auth-service runs locally with `ENVIRONMENT=dev`): `npm run api:gen` fetches it; the JSON snapshot and the
  generated types are committed, so CI never needs the server. Calls go through `openapi-fetch` (typed paths,
  bodies, responses). Error codes are a hand-written union from auth-service's README.
- **One place** (`src/lib/api/`): adds `Authorization: Bearer …`; turns every non-2xx into
  `ApiError { status, code, message }` (code branches on `code`, never on `message`); network failures get
  their own type. It never imports a store: `getAccessToken`, `refreshSession`, `onSessionEnded` are passed in.
- **Refresh** (`SessionStore.refresh()`): one at a time (a shared promise), about a minute before the access
  token expires and on `401 invalid_token` (then the request is retried once). The new tokens are saved to
  secure storage **before** they're used; a lost reply is retried with the same refresh token; replies to
  given-up requests are ignored. `401 invalid_refresh_token` → signed out (log in by SMS);
  `403 account_blocked` → signed out with a message; `403 action_not_allowed` → an error on that screen.
- **Login flow:** `otp/request {phone}` → SMS code → `otp/verify {phone, code, device}` → tokens, or a
  registration token (kept **in memory only**) → `register {registration_token, display_name, device}` →
  tokens. Platform `ios`/`android`. A new SMS login signs the previous phone out (one primary device).
- **Token storage:** `expo-secure-store`, one JSON item `{access, refresh, accessExpiresAt}` (one write keeps
  them consistent), `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (not restored to another phone; readable for
  background work after the first unlock). The iOS Keychain survives uninstalling the app, so the first
  launch after an install wipes it: a reinstall starts logged out, as the server treats it as a new device.
- **Phone input:** `libphonenumber-js` turns what's typed (`050-123-4567`, `+972 50 …`) into E.164, then the
  exact server rule `^\+9725\d{8}$` (Israeli mobiles). SMS-code field: `textContentType="oneTimeCode"` (iOS),
  `autoComplete="sms-otp"` (Android) for autofill.

## 8. Language, right-to-left, light and dark

- **The app follows the phone's language:** the first of the phone's preferred languages that we support
  (`he`, `en`), otherwise **English** (`src/lib/i18n.ts`). Android 13+ and iOS also offer a per-app language
  in the system settings (`supportedLocales` in `app.config.ts`).
- **Right-to-left:** `supportsRTL: true`; React Native mirrors the layout for an RTL language. In styles use
  only **`start`/`end`** (`marginStart`, `paddingEnd`, `start: 0`), never `left`/`right`, and
  `textAlign: 'auto'`, so Hebrew mirrors correctly. Phone numbers and codes are always shown left-to-right.
- **Texts** live in `locales/he.json` and `locales/en.json` (same keys, tested); keys are typed:
  `t('auth.loggedOut.title')`, and a typo is a type error.
- **Light and dark:** `userInterfaceStyle: "automatic"`. Every colour is a token with a light and a dark value
  (`src/ui/theme.ts`); `useTheme()` follows the phone's setting and re-renders when it changes. Components
  never hard-code colours.

## 9. Configuration

| Setting | Where | Value |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `.env.production` (committed) | `https://jzviagin-chat-app.129-159-150-34.sslip.io` (release builds, `expo export`) |
| | `.env.development` (committed) | `http://localhost:8000`: local auth-service, reached from the S22 via `adb reverse tcp:8000 tcp:8000` |
| | `.env.development.local` (gitignored, optional; see `.env.example`) | Your own override, e.g. the Mac's LAN IP |

Plain `http` works only in debug builds: Android's generated debug manifest sets
`usesCleartextTraffic="true"`; release builds allow HTTPS only (prod is HTTPS).

`EXPO_PUBLIC_*` values are **inlined into the JavaScript bundle**, so anyone can read them: **no secrets in
the app** (none are needed). `src/lib/config.ts` is the only reader of `process.env` and validates with zod at
startup (fails fast, like pydantic-settings).

## 10. Rules
- **Never log or display tokens, SMS codes or full phone numbers.** Use `log` from `src/lib/log.ts`
  (`console` is a lint error elsewhere); it masks phone numbers (`+97250***4567`) and token-like strings as a
  safety net. Tokens only in secure storage; the registration token only in memory.
- Native packages only via `npx expo install`; never edit `ios/` or `android/` (generated).
- Styles: `start`/`end`, never `left`/`right`; colours only from the theme.
- Routes are thin; logic lives in features; features talk through their `index.ts`.
- Store changes only in actions; actions return errors as state.
- Tests for every store, pure function and screen; screens in Hebrew and English, light and dark.

## 11. Everyday commands

One-time setup (Mac): Node 24 (`nvm use`), Android Studio (SDK + platform tools), Xcode for iOS, then:
```bash
cd "$(git rev-parse --show-toplevel)"
npm ci                       # install exactly what package-lock.json says (≈ uv sync --frozen)
```

| Task | Command | Node equivalent |
|---|---|---|
| Build + install + run on the S22 (USB) | `npm run android` | – |
| Run in the iOS simulator | `npm run ios` | – |
| Dev server only (app already installed) | `npm start` | `nodemon` |
| All checks (run before every commit) | `npm run check` | – |
| Tests / watch | `npm test` / `npm test -- --watch` | `jest` |
| Lint | `npm run lint` | `eslint` |
| Format / check | `npm run format` / `npm run format:check` | `prettier` |
| Type check | `npm run typecheck` | `tsc --noEmit` |
| Dependency + config health | `npm run doctor` | – |
| Add a package | `npx expo install <pkg>` (dev: `npx expo install -- --save-dev <pkg>`) | `npm i` |
| Production JS bundle (what CI checks) | `npx expo export --platform android` | `vite build` |

CI (`.github/workflows/ci.yml`, job **`check`**) runs lint, format check, type check, tests, `expo-doctor`
and a production bundle on every pull request and again on `main` after each merge.

`package.json` → `expo.doctor.reactNativeDirectoryCheck.exclude` lists two packages that Expo itself brings
in (`expo-modules-core` from `expo`, `@react-native-masked-view/masked-view` from `expo-router`). When
expo-doctor can't download Expo's list of bundled modules (as happened on the CI runner), it checks them
against React Native Directory and fails the build. Exclude only Expo-owned transitive packages here.

## 12. Build plan
Each step is agreed with the owner, built on a branch and merged before the next (chat-infra `PLAN.md` phase 8).

1. 🔨 **Design + skeleton**: this README, tooling, CI; the app boots to an empty logged-out screen.
2. **Login**: phone → SMS code (`otp/request`, `otp/verify`) → display name for a new number (`register`) →
   tokens in secure storage. API client + generated types.
3. **Session**: refresh before expiry (one at a time), sign-out on `invalid_token` / `invalid_refresh_token`,
   logout, the devices screen (primary only); the `MobxQuery` adapter.
4. **End-to-end check**: one login traced app → ingress → auth → Postgres in Grafana.

Later (recorded, not scheduled):
- **Release build + over-the-air updates**: a release APK on the S22 and **expo-updates** with EAS Update
  (free plan: 1,000 monthly active users; needs a free Expo account): runtime-version policy, channel. Updates
  only reach release builds (development builds always load JS from Metro).
- End-to-end UI tests (Maestro).
- Phase 9 client: WebSocket (`src/realtime/`), SQLite inbox with cursor and cumulative acks (`src/data/`).
- Push notifications (`expo-notifications`; iOS needs the paid Apple account), device keypair for E2E
  (native crypto, private key in secure storage), QR device linking (`expo-camera`).
