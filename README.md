# mobile-app

**Walkie Talkie**, the chat app for phones: Expo / React Native + TypeScript. Part of the chat system in
GitHub org `jzviagin-chat-app`; the system design (services, contracts, phases) lives in
[chat-infra/docs](https://github.com/jzviagin-chat-app/chat-infra/tree/main/docs).

**This is the real app, not a throwaway demo.** It starts with only the login flow, but its structure is the
foundation for everything that comes later (chats over WebSocket, local message store, media, push, E2E).

> **Status: login (phase 8 step 2).** Sign in by SMS code (phone → code → display name for a new number),
> stay signed in across restarts, sign out. Hebrew or English, light or dark, following the phone.
> Next: the session (step 3: token refresh, the devices screen).

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
| Keyboard | **react-native-keyboard-controller** (+ `react-native-reanimated`) | – | Follows the keyboard natively, also with Android's edge-to-edge display (SDK 58 default), where the window doesn't shrink for it; recommended by Expo's keyboard guide. React Native's own `KeyboardAvoidingView` left the buttons behind the keyboard when a login step switched with it open |
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

**Talking to a local auth-service** (how the login is developed; ₪0): run auth-service on the Mac with
`ENVIRONMENT=dev`, so its fake SMS sender writes each code to its log instead of sending an SMS:
```bash
# (Mac) one-time setup: auth-service README §12 (uv sync, cp .env.example .env)
cd ~/code/auth-service                     # your auth-service checkout, on main
docker compose up -d                       # local Postgres + Redis
uv run alembic upgrade head
ENVIRONMENT=dev uv run uvicorn auth_service.main:app --reload   # :8000; codes appear in this log
```
Then the phone needs `adb reverse tcp:8000 tcp:8000`, so its `localhost:8000` reaches the Mac (see §9).
`npm start` and `npm run android` run it for you (`npm run reverse`). Reconnecting the phone (often, with
Wi-Fi debugging) drops it: the app then says "No connection", and `npm run reverse` restores it. With
several devices attached, run `adb -s <device> reverse tcp:8000 tcp:8000` for each. Against production (real SMS, prepaid credits) only for a final check: set `EXPO_PUBLIC_API_URL`
in `.env.development.local`.

## 4. Project layout

```
src/
  app/                    Routes only (Expo Router). Thin files: they pick the stores a screen needs.
    _layout.tsx           Root: config check, RootStoreProvider, RootNavigator
    auth.tsx              /auth → the login (all its steps)
    (app)/                Logged-in routes. index.tsx → /  (placeholder home with "Sign out")
  root/                   RootStore (creates and wires every store), RootStoreProvider + useRootStore(),
                          RootNavigator (signed in ⇄ signed out), test-deps (fakes for tests), MobX config
  features/
    auth/                 Login: AuthStore (session), LoginFlowStore (the login state machine), phone
                          numbers, countries, screens. Public surface: index.ts
    home/                 The placeholder home screen
                          later: features/devices, features/chats, features/contacts, …
  lib/                    No UI, no stores: config (zod), i18n, log (masking), api/ (auth-service client),
                          secure-item + token-storage (secure storage), fresh-install, device, clock
                          later: lib/query (MobxQuery adapter, step 3)
  ui/                     Theme tokens + shared components (Screen, Text, Button, TextField, OtpInput)
locales/                  he.json, en.json (same keys; typed)
scripts/                  Dev scripts run on the Mac (api-gen, gen-country-names)
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
| Client state | MobX store fields | `auth.status`, later: connection state, drafts |
| Request/reply server data | TanStack Query's cache, exposed by a store through a `MobxQuery` (step 3) | devices list, profile, contacts |
| Pushed data (phase 9) | MobX stores over SQLite + the WebSocket | chats, messages, typing, online |

**Root store, no singletons.** `RootStore` (`src/root/`) creates the `QueryClient`, i18n and every store,
and passes each store **only what it needs** through its constructor (the API client, token storage, another
store's action), never the whole root, so features never import `root` (no import cycles). Its dependencies
(`RootStoreDeps`: the phone's languages, the API client, token and login-progress storage, the device, a clock,
the fresh-install check) come in through its constructor. `RootStoreProvider` (wrapped around the whole app by
the root layout) builds the real ones and creates **the one** `RootStore` on its first render (`useState`'s
initializer runs once, so re-renders never make a second), restores the saved session and login progress
(`root.restore()`, no requests), disposes it on unmount and gives it to screens; `useRootStore()` reads it.
Tests pass fakes instead (`deps={testDeps(...)}` from `src/root/test-deps.ts`: a fake API of `jest.fn`s,
in-memory storage), so each test gets a fresh store, like building an Express app per test.

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

Two sides, switched by the session (`src/root/RootNavigator.tsx`):
```tsx
<Stack.Protected guard={auth.isSignedIn} redirectTo="/auth">  <Stack.Screen name="(app)" />  </Stack.Protected>
<Stack.Protected guard={!auth.isSignedIn} redirectTo="/">     <Stack.Screen name="auth" />   </Stack.Protected>
```
- `auth.status` is `loading` until secure storage has been read once: the native splash screen stays up
  meanwhile, so no login screen flashes past when you're already signed in.
- A guard only switches screens on or off; it never gives a screen another address. `redirectTo` says where
  a blocked screen sends you: the app always starts at `/` (`(app)/index`), so a signed-out start goes to
  `/auth`, and a signed-in start at `/auth` (a link) goes to `/`.
- When the session changes, the router switches sides and **removes the other side's history**, so back
  can't return to the login after signing in, or to a logged-in screen after signing out.

**The login is one route with a state machine.** `/auth` shows `LoginScreen`, which renders the step held
by `LoginFlowStore.step` (`phone` → `code` → `name`). Separate routes would let Android's back button pop a
screen while the store still says "code requested"; with one route the store is the only truth. Only
"Change number" goes back: it calls `login.back()`, which **clears the whole login** (an empty phone step,
nothing saved). Android's back button (`BackHandler`) does nothing on the code and name steps, and leaves
the app as usual on the first step (owner, 2026-11-13). Each step's main buttons sit at the bottom (`Screen`'s `footer`) and rise with the
keyboard. Steps switch without an animation: a fade-in that starts invisible left a step blank for
seconds on a busy emulator.

**Lazy loading.** On a phone the whole JS bundle (Hermes bytecode) is already in the app; what matters is
that a screen's code doesn't *run* before it's needed. Expo Router gives each route to React Navigation as
`getComponent: () => …` (`expo-router/build/useScreens.js`), which is called the first time the screen
renders; only then is the route file evaluated, and Metro evaluates a module (and its imports) on first
`require`. So routes and their features load lazily without `React.lazy`. (Exception: in development only,
Expo Router loads every route once at startup to warn about missing default exports.) Keep route files thin
anyway: re-export a feature screen.

## 7. API client, tokens and the login

**API client** (`src/lib/api/`, built in step 2):
- **Types** from auth-service's OpenAPI schema with `openapi-typescript` (the schema exists only when
  auth-service runs locally with `ENVIRONMENT=dev`): `npm run api:gen` fetches it; the JSON snapshot and the
  generated types are committed, so CI never needs the server. `openapi-typescript` runs through `npx` at a
  pinned version (it declares a TypeScript 5 peer; the generated file works with TypeScript 6).
- Calls go through `openapi-fetch` (typed paths, bodies, responses), with a 15 s timeout. Every call returns
  the success body or throws **`ApiError { status, code, details }`** (code branches on `code`, never on the
  server's message) or **`NetworkError`** (`offline` / `timeout`). Error codes are a hand-written union from
  auth-service's README. `details` holds the error's machine-readable fields, each type-checked (a wrong
  value is dropped): `limit` and `retryAfterSeconds` (429, 503; else the `Retry-After` header),
  `attemptsLeft`, `resendAfterSeconds` (the code errors). It never logs bodies or headers.

**Tokens** (`src/lib/token-storage.ts`): `expo-secure-store`, one JSON item `{access, refresh,
accessExpiresAt}` (one write keeps them consistent), `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (not restored to
another phone, not in backups; readable for background work after the first unlock).
- `accessExpiresAt` = time of receipt + `expires_in`, on the **phone's own clock** (not the JWT's `exp`, which
  is server time): a wrong phone clock doesn't matter.
- **Signed in = we hold tokens** (`AuthStore.isSignedIn` is computed from them). **Auto login sends no
  request**: saved tokens mean signed in, also offline.
- The iOS Keychain survives uninstalling the app, so the first launch after an install
  (`src/lib/fresh-install.ts`: a marker file in the app's documents folder, which is deleted with the app)
  wipes the saved tokens and login progress.
- **Sign out** clears the tokens on the phone at once, then sends `POST /auth/logout` without waiting. If that
  fails (offline; or 401 for an expired access token until refresh exists), the device stays active on the
  server until the next SMS login replaces it.

**Refresh (decided 2026-11-09, built in step 3):**
- Before each logged-in request the API client awaits `getAccessToken()` (= `auth.freshAccessToken()`):
  if the access token expires within 60 s, it refreshes first.
- On `401 invalid_token` (a wrong clock, a revoked device, a rotated key): refresh once, retry the request
  once; if the token already changed meanwhile, just retry with the new one.
- **One refresh at a time:** a shared `refreshPromise`; logged-in requests wait on it, unauthenticated ones
  never do.
- Outcomes: success → **save the new tokens first, then use them**; a lost reply → retry with the same
  refresh token (auth-service allows it); offline → keep the tokens, fail the request with "no connection",
  **never sign out**; `401 invalid_refresh_token` → signed out; `403 account_blocked` → signed out with a
  message; `403 action_not_allowed` → an error on that screen.
- No timer for normal calls (timers stop while the phone sleeps the app anyway). Phase 9 adds a socket-only
  timer: an open WebSocket sends a fresh `auth` message before the token expires.
- The API client receives `getAccessToken` and `onUnauthorized`; it never imports a store.

**The login** (`LoginFlowStore`, a state machine; actions return `{ok}` / `{ok:false, error}`, never throw):
```
phone ──requestCode──► code ──verify: logged_in──────────────► signed in
  ▲                     │ ▲ └─verify: registration_required──► name ──register──► signed in
  ├────── back() ───────┘ └─ the code expired: stays, "Send a new code"   │ (no way back from the name step)
  └──────────── the registration token expired ─────────────────────────┘ (everything cleared, with a notice)
```
- `otp/request {phone}` → SMS → `otp/verify {phone, code, device}` → tokens, or a registration token (10
  min) → `register {registration_token, display_name, device}` → tokens. `device` = platform + the phone's
  name (`expo-device`: the name from the phone's settings on Android; the model on iOS, where the name is just
  "iPhone" without a special entitlement). A new SMS login signs the previous phone out (one primary device).
- **"Change number" clears the login** (owner rule): every field, and the saved progress, but not the
  waits (below). It works **at any time** on the code step, because a number's wait is only that number's
  (owner, 2026-11-13): typed again, that number shows its countdown on the phone step; another number is
  free. Only a **device lock** disables it, with the same countdown as "Send a new code" on both buttons
  ("Change number in 47:12"). The name step has **no way back** (the code is verified: the only way is on).
- **The code step stays in every case** (owner, 2026-11-11): a wrong code shows the tries left
  (`attempts_left`) and the field takes the next code at once; after the 5th wrong try
  (`too_many_attempts`) the field is disabled until a new code is sent. If the server ever asks to wait
  before the next try (`retry_after_seconds` on `invalid_code`: not sent today), the field is disabled
  with a countdown. A number's wait only ever grows: the 202's wait (an hour after the window's last
  code) beats the cooldown a verify error reports.
- **An expired code keeps the code step** (owner, 2026-11-13): "That code has expired. Request a new
  one.", typing still allowed and the buttons as usual ("Send a new code" after the number's wait); a new
  code clears it. Noticed while the app is open (a reaction on the clock, also right after the app returns
  from the background), at startup, or from the server's `code_expired` (its answer for an expired, a used
  and a missing code).
- **An expired registration token starts over** (owner, 2026-11-12): an empty phone step with "That took
  too long", while the app is open, at startup, or from the server (`invalid_registration_token`).
- Every deadline is an absolute time on the phone's clock, so time spent closed counts: reopened inside
  the window, the step resumes with only the time left.
- **Refused code requests are shown live and remembered; a refusal never moves the login on.**
  `429 rate_limited` names its `limit`: `resend_cooldown`, `phone_hour` and `phone_day` block that number
  (Continue disabled while it's typed; other numbers work); `ip_hour` / `ip_day` and the daily SMS cap
  (`503` + `Retry-After`) block every number. Each shows "try again in 47:12", counting down from the
  server's wait. A `resend_cooldown` on the phone step means a code went out within the minute (a lost
  reply, a reinstall, a sign-in on another phone): whether it can still be used is unknown, so the app
  waits instead of opening the code step (owner, 2026-11-13).
- **The waits are two kinds of send blocks** (owner, 2026-11-13), the only record of them, in their own
  secure item (`send-blocks`) apart from the login progress:
  1. **the device lock** (`all`): every number, from `ip_hour` / `ip_day` (this network) or the daily SMS
     cap; it disables Continue, "Send a new code" and "Change number";
  2. **one wait per number** (`numbers`): its cooldown or hour / day limit, from the 202's
     `resend_after_seconds`, the verify errors' and the 429s. That number counts down on the phone step
     (and on the resend button); other numbers are free.

  The server never limits by device: "device" here means this network's IP address. A 202's long wait
  (this code used a window's last slot) doesn't say yet whether the window is the number's or the
  network's: the app reads a planned `limit` field (`ip_*` → device lock) and treats a wait without it as
  the number's; if it was the network's, the next number's `429 ip_hour` locks the device (a refused
  request costs nothing). Going back, signing in and signing out don't clear the blocks; a block only ever
  gets later and is removed when its time is up (also from storage). Only a fresh install clears them.
- **The code and name steps survive closing the app:** `{country, step, phone, code expiry, code
  state, tries left, registration token}` is saved in its own secure-store item after every change on those
  steps and restored at startup while the code / registration token is still valid. The phone step is
  never saved. Without it a restart would cost a new SMS or hit the cooldown (`429`). The registration
  token is deleted on use, expiry, back and sign-in.
- `login_conflict` → retried once automatically; `already_registered` → an empty phone step with a notice.

**Phone numbers** (`features/auth/phone.ts`, `countries.ts`):
- A **searchable country dropdown** under the country button (`CountryDropdown`): a search field (name in
  Hebrew or English, ISO code, calling code) and up to 5 rows (as many as fit above the keyboard) that
  scroll through every country; it opens above the button when there's no room below, and closes on a tap
  outside or Android back. The list is built once per language, only when the dropdown first opens
  (sorting 245 names is slow on Hermes).
  Hard-coded lists:
  `SELECTABLE_COUNTRIES` (IL, US, GB, DE, FR, ES, CA: validated and formatted on the device) and
  `SIGN_IN_COUNTRIES` (IL: what the server accepts, an SMS cost guard). A valid number of another selectable
  country is blocked on the device ("not available yet"), without a request. Every other country is listed
  but greyed out. When the server supports more countries, switch to a list from the server.
- What's typed (`050-234-5678`, `0502345678`, a pasted `+972 50 …`) is formatted as you type and turned into
  E.164 by `libphonenumber-js` (its `mobile` metadata, so landlines are rejected). **Israel uses the server's
  exact rule `^\+9725\d{8}$`**: libphonenumber also knows which ranges are allocated and rejects e.g.
  `050-1xx-xxxx`, which the server accepts; the device must never block what the server takes. The server
  checks again and has the final say (`400 invalid_phone`).
- Country names come from `country-names.json`, generated once with Node's `Intl.DisplayNames`
  (`node scripts/gen-country-names.mjs`), so the app doesn't depend on Hermes supporting it.

**The code field** (`ui/OtpInput.tsx`): **one hidden `TextInput`, drawn as 6 boxes**, so paste and the
keyboard's SMS autofill (`textContentType="oneTimeCode"` on iOS, `autoComplete="sms-otp"` on Android) fill
all six at once and backspace just works (six separate inputs break both). It submits by itself at 6 digits.

## 8. Language, right-to-left, light and dark

- **The app follows the phone's language:** the first of the phone's preferred languages that we support
  (`he`, `en`), otherwise **English** (`src/lib/i18n.ts`). Android 13+ and iOS also offer a per-app language
  in the system settings (`supportedLocales` in `app.config.ts`).
- **Right-to-left:** `supportsRTL: true`; React Native mirrors the layout for an RTL language. In styles use
  only **`start`/`end`** (`marginStart`, `paddingEnd`, `start: 0`), never `left`/`right`, and
  `textAlign: 'auto'`, so Hebrew mirrors correctly. Phone numbers and codes are always shown left-to-right.
- **Texts** live in `locales/he.json` and `locales/en.json` (same keys, tested); keys are typed:
  `t('auth.phone.title')`, and a typo is a type error.
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
- **Never log tokens, SMS codes or phone numbers, and never display tokens or other people's full
  numbers.** The user's own number may be shown to them (the code step: "sent to 050-234-5678", so a typo is
  easy to spot). Use `log` from `src/lib/log.ts` (`console` is a lint error elsewhere); it masks phone numbers
  (`+97250***4567`) and token-like strings as a safety net.
- Tokens and the login progress only in secure storage (this device only). The registration token is
  deleted on use, expiry, back and sign-in.
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
| Refresh auth-service's API types (local auth-service running) | `npm run api:gen` | – |
| Let the phone reach the local auth-service again ("No connection") | `npm run reverse` | – |

CI (`.github/workflows/ci.yml`, job **`check`**) runs lint, format check, type check, tests, `expo-doctor`
and a production bundle on every pull request and again on `main` after each merge.

`package.json` → `expo.doctor.reactNativeDirectoryCheck.exclude` lists two packages that Expo itself brings
in (`expo-modules-core` from `expo`, `@react-native-masked-view/masked-view` from `expo-router`). When
expo-doctor can't download Expo's list of bundled modules (as happened on the CI runner), it checks them
against React Native Directory and fails the build. Exclude only Expo-owned transitive packages here.

## 12. Build plan
Each step is agreed with the owner, built on a branch and merged before the next (chat-infra `PLAN.md` phase 8).

1. ✅ **Design + skeleton**: this README, tooling, CI; the app boots to an empty logged-out screen.
2. 🔨 **Login**: phone → SMS code (`otp/request`, `otp/verify`) → display name for a new number (`register`) →
   tokens in secure storage; **sign-out** (moved here from step 3, to test the login repeatedly). API client
   + generated types, country picker, login progress that survives a restart.
3. **Session**: refresh (§7: before a request + on 401, one at a time), sign-out on `invalid_refresh_token`,
   the devices screen (primary only); the `MobxQuery` adapter and TanStack's focus / online wiring for
   React Native (`focusManager` ← `AppState`, `onlineManager` ← network status).
4. **End-to-end check**: one login traced app → ingress → auth → Postgres in Grafana.

Later (recorded, not scheduled):
- **Release build + over-the-air updates**: a release APK on the S22 and **expo-updates** with EAS Update
  (free plan: 1,000 monthly active users; needs a free Expo account): runtime-version policy, channel. Updates
  only reach release builds (development builds always load JS from Metro).
- **App observability (debugging production)**: crash reports and JavaScript errors with stack traces, app
  logs (masked, through `src/lib/log.ts`) and traces that continue into the backend (`traceparent` on API
  calls, so one request is visible app → ingress → auth in Grafana). Free only; never tokens, codes or full
  phone numbers. To decide then: our own Grafana stack (needs a public, rate-limited Alloy endpoint) or a
  hosted crash reporter with a hard-capped free tier; native crash capture.
- End-to-end UI tests (Maestro).
- **Reading the SMS code automatically on Android** (Google's SMS User Consent API: a system prompt, no
  change to the SMS text; needs a native module: check for a maintained package first).
- **International numbers:** the server and an SMS provider for those countries first, then serve the
  country list from the server instead of `SELECTABLE_COUNTRIES` / `SIGN_IN_COUNTRIES`.
- Phase 9 client: WebSocket (`src/realtime/`), SQLite inbox with cursor and cumulative acks (`src/data/`).
- Push notifications (`expo-notifications`; iOS needs the paid Apple account), device keypair for E2E
  (native crypto, private key in secure storage), QR device linking (`expo-camera`).
