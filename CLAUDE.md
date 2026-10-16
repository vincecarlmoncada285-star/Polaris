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
  dismissals, apply; `setExternalMatches()` merges in AI matches, keyed by paragraph text, rules
  win on overlap); `ai-scheduler.ts` is the framework-free client scheduler for AI requests
  (only paragraphs changed since the document opened, 1.5 s idle, 8+ words, 2 in flight, last
  edit first, abort on change, client cache, stop on 403/503, 429 backoff, failures retried;
  fetch and timers injected). The Settings text (`AiToggle.tsx`) must match what it sends.
  `locate.ts` finds a measured sentence, a quoted passage (via `anchor.ts`) or the n-th
  paragraph in the current doc, for the Overview and Review to select.
- `src/lib/ai/`: Claude paragraph suggestions and document reviews (server only, except
  `protocol.ts`).
  - `client.ts`: `import "server-only"`; lazy SDK client, `isAiConfigured()`, and the one place
    that picks the model (`POLARIS_AI_MODEL`) and effort (`POLARIS_AI_PARAGRAPH_EFFORT`,
    `POLARIS_AI_REVIEW_EFFORT`, default high).
  - `paragraph.ts`: system prompt (keep it byte-stable; bump `PROMPT_VERSION` when it, the user
    message or the schema changes), user message, the `beta.messages.parse` request, refusal /
    max_tokens handling.
  - `review.ts`: the whole-document review. Byte-stable `REVIEW_SYSTEM_PROMPT` (bump
    `REVIEW_PROMPT_VERSION` when it, the user message or the schema changes); user message
    (goals, title, outline, `[P1]`-numbered paragraphs in `<document>`); streamed request
    (`beta.messages.stream` + `finalMessage()`, 64000 max_tokens, fallbacks as for paragraphs);
    refusal -> `{ refused: true }`, max_tokens -> `AiOutputError`. `review-schema.ts`: its zod/v4
    schema and `cleanReview()` (limits, quotes anchored to the plain text or dropped).
  - `untrusted.ts`: the neutralizer for student text between our tags (`createNeutralizer(tags)`,
    one tag list per prompt) and for `[P3]`-like markers. `structured.ts`: the non-throwing
    output format, "text after the last fallback block" parsing, `AiOutputError`.
    `route-errors.ts`: the SDK-error -> response mapping both AI routes share.
  - `schema.ts` (zod/v4 structured-output schema + clean-up), `anchor.ts` (quote -> offsets),
    `cache.ts` (LRU + TTL, sha256 keys), `limits.ts` (30/min, 600/day per user for paragraphs;
    6/hour, 30/day for reviews), `protocol.ts` (request schema and response types shared with
    the client, review types and word limits; plain zod).
  - Routes: `src/app/api/ai/paragraph/route.ts`; `src/app/api/documents/[id]/review/route.ts`
    (POST runs and saves a review, `maxDuration = 300`; GET returns the latest with `stale`).
- `src/lib/documents/`: zod schemas (goals include the optional `targetWords`) + service (takes
  a PrismaClient, so tests use a temp DB). Every method takes `userId` first. `reviews.ts`:
  saved reviews (`DocumentReview`), newest 5 per document, `contentHash()` (sha256 of the
  reviewed blocks' text and heading levels) for staleness. `blocks.ts`: textblocks from the
  stored TipTap JSON (`reviewBlocks()`: what a review sends, measures and hashes; never the
  separately saved plainText), and the paragraph numbering both the review prompt and the
  editor use.
- `src/lib/text/`: `stats.ts` (word count, reading time) and `metrics.ts`, the Overview's pure
  metrics (sentences via `splitSentences`, passive via the `passiveVoice` rule, Flesch scores
  with a documented syllable heuristic, MATTR, repeated openers, longest-sentence offsets).
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
- `src/components/`: React UI (`auth/`, `settings/`, `Navbar.tsx`). The editor's side panel is
  `PanelTabs.tsx` (WAI-ARIA tabs, roving tabindex, choice remembered in localStorage;
  `useRememberedTab()` also returns `show()`, a switch that is not remembered, used to show
  Suggestions when an underline is clicked) holding `SuggestionPanel.tsx`, `OverviewPanel.tsx`
  (recomputes 300 ms after the text or the heading layout changes, only while shown) and
  `ReviewPanel.tsx` (GET when shown, POST after flushing the autosaver, Cancel aborts, stale when
  the editor text or heading layout differs from what was reviewed). The layout comes from
  `blockLayout()` in `src/lib/editor/locate.ts`.

## Conventions

- Every rule needs unit tests for matches **and** for non-matches (false positives matter more
  than misses; students lose trust in noisy tools).
- Explanations are written to a student, in one or two sentences, and say _why_.
- Never auto-apply changes. The writer always chooses.
- Accessibility: every control needs an accessible name; colour is never the only signal
  (cards carry the category label).
- Keep `ANTHROPIC_API_KEY` server-side only. Never log document text.
- Never send text to Claude unless the user has aiEnabled; never log prompts or model output;
  tests mock the Anthropic client. A review sends the whole document, its title and goals: the
  Settings text and the Review tab must say so.
- Every API route calls requireUser() first and scopes queries by userId; another user's resource is a 404.
- Server-rendered numbers go through `formatNumber()` (`src/lib/text/format.ts`, fixed en-US locale)
  and dates through `<LocalDateTime>`; the runtime's own locale or timezone would make the server
  and browser text differ (a hydration mismatch). `e2e/locale.spec.ts` checks this.
- E2E tests sign up a fresh user with `signUp()` from `e2e/helpers.ts` (it also gives each
  context its own IP via X-Forwarded-For, which the e2e server trusts because Playwright sets
  `TRUSTED_PROXY_HOPS=1`; by default the app ignores that header).
