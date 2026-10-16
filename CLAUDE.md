# Polaris: notes for Claude

Academic writing assistant. Next.js 15 (App Router) + TypeScript (strict) + Tailwind v4 +
TipTap 3 + Prisma (SQLite locally) + Auth.js v5 + Vitest + Playwright.

## Commands

- `npm test`: unit tests. Run them before every commit.
- `npm run test:e2e`: builds and serves on :3100 against a fresh `prisma/e2e.db` (recreated
  each run). Playwright passes a test-only `AUTH_SECRET`, so no `.env` is needed.
- `npm run typecheck && npm run lint`

## Layout

- `src/lib/rules/`: the rule engine. Pure functions over a paragraph's plain text; no editor imports.
  - `builtin.ts`: rules. Add a rule there, then add it to `BUILTIN_RULES` (order = overlap priority).
  - `engine.ts`: runs rules, resolves overlaps, LRU cache keyed by context + text.
- `src/lib/editor/`: ProseMirror bridge. `textblocks.ts` maps text offsets to doc positions
  (inline atoms count as U+FFFC); `suggestions.ts` is the TipTap extension (decorations,
  dismissals, apply).
- `src/lib/documents/`: zod schemas + service (takes a PrismaClient, so tests use a temp DB).
  Every method takes `userId` first.
- `src/lib/users/`: zod schemas + users service (create, verifyCredentials, profile, password,
  delete). Same PrismaClient-injection pattern.
- Auth (Auth.js v5, Credentials + JWT sessions):
  - `src/auth.config.ts`: edge-safe config (pages, `authorized`, jwt/session callbacks). Used by
    `src/middleware.ts`. Never import Prisma or bcrypt here.
  - `src/auth.ts`: full config (Credentials provider, sign-in rate limit); exports
    `handlers, auth, signIn, signOut`. Route handler: `src/app/api/auth/[...nextauth]/route.ts`.
  - `src/lib/auth/session.ts`: `requireUser()` for API routes, `getCurrentUser()` and
    `requirePageUser()` for server components.
  - `src/lib/auth/`: `routes.ts` (what middleware protects), `callback-url.ts` (open-redirect
    sanitizer), `actions.ts` (sign-in/up/out server actions), `limits.ts` (auth rate limits; `clientIp()` trusts X-Forwarded-For only with
    `TRUSTED_PROXY_HOPS`).
  - `src/types/next-auth.d.ts`: types `session.user.id` as string.
- `src/lib/rate-limit.ts`: generic in-memory sliding-window limiter with an injectable clock.
  Reuse it for AI routes.
- `src/lib/autosave.ts`: debounced, serialized saver. Anything holding unsaved edits registers
  with `registerPendingSave()`; `SignOutButton` awaits `flushPendingSaves()` before the session
  cookie is cleared.
- `src/components/`: React UI (`auth/`, `settings/`, `Navbar.tsx`).

## Conventions

- Every rule needs unit tests for matches **and** for non-matches (false positives matter more
  than misses; students lose trust in noisy tools).
- Explanations are written to a student, in one or two sentences, and say _why_.
- Never auto-apply changes. The writer always chooses.
- Accessibility: every control needs an accessible name; colour is never the only signal
  (cards carry the category label).
- Keep `ANTHROPIC_API_KEY` server-side only. Never log document text.
- Every API route calls requireUser() first and scopes queries by userId; another user's resource is a 404.
- E2E tests sign up a fresh user with `signUp()` from `e2e/helpers.ts` (it also gives each
  context its own IP via X-Forwarded-For, which the e2e server trusts because Playwright sets
  `TRUSTED_PROXY_HOPS=1`; by default the app ignores that header).
