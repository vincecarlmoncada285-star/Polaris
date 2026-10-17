# Polaris: notes for Claude

Academic writing assistant. Next.js 15 (App Router) + TypeScript (strict) + Tailwind v4 +
TipTap 3 + Prisma (SQLite locally) + Auth.js v5 + Vitest + Playwright.

## Commands

- `npm test`: unit tests. Run them before every commit.
- `npm run test:e2e`: builds and serves on :3100 against a fresh `prisma/e2e.db` (recreated
  each run). Playwright passes a test-only `AUTH_SECRET`, so no `.env` is needed.
- `npm run typecheck && npm run lint`
- `overrides` in package.json gives mammoth argparse 2.0.1: argparse 1 pulls in sprintf-js
  (GHSA-hp3w-g68c-fv3c, no fixed version), only mammoth's CLI uses argparse, and 2.x keeps its
  old method names. Remove the override once mammoth depends on argparse 2.

## Layout

- `src/lib/rules/`: the rule engine. Pure functions over a paragraph's plain text; no editor imports.
  - `builtin.ts`: rules. Add a rule there, then add it to `BUILTIN_RULES` (order = overlap priority).
  - `engine.ts`: runs rules, resolves overlaps, LRU cache keyed by context + text.
- `src/lib/editor/`: ProseMirror bridge. `extensions.ts` is the shared extensions list
  (`documentExtensions()`: StarterKit, its Link mark registered separately with only an `href`
  attribute so rel and target are always `LINK_ATTRIBUTES` and pasted links pass the allow-list
  (`shouldAutoLink` too; a link parsed from HTML must pass the strict `isAllowedLinkHref`),
  Footnote, the Ctrl-click / Mod-k link behaviour): the editor, the importer and the tests all
  build the schema from it.
  `footnote.ts`: the `footnote` inline atom (attrs id + content; `<sup data-footnote
data-content>`; renderText "" so plain text, word counts and getText() leave it out), a DOM
  node view numbered through node decorations, Mod-Alt-f / Enter, and the insert / save / delete
  helpers (a just-inserted footnote's text folds into its insertion: one undo removes it).
  `links.ts`: the link allow-list (http, https, mailto; `isAllowedLinkHref` strict,
  `isAllowedLinkUri` for autolink, `normalizeLinkInput` for the dialog). `textblocks.ts` maps
  text offsets to doc positions (inline atoms count as U+FFFC; `footnotes: "omit"` leaves
  markers out for the Overview and quote finding; `withoutFootnotes()` is what Claude is sent and
  what the rules read, and both kinds of match are mapped back through it, dropping a fix that
  would replace a marker); `suggestions.ts` is the TipTap extension (decorations,
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
    (goals, title, outline, `[P1]`-numbered paragraphs in `<document>` with `[^n]` footnote
    markers, and a numbered "Footnotes:" list at its end); streamed request
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
- `src/lib/documents/`: zod schemas (goals include the optional `targetWords`; create accepts
  an import's title, content and plainText under the update limits) + service (takes a
  PrismaClient, so tests use a temp DB). Every method takes `userId` first; `exportPage()` pages
  by id for the data export (`src/app/api/documents/export/route.ts`), at most 20 documents and
  about 8 M characters a page, plainText only when the content is unusable; `limits.ts`: 300
  export pages an hour per user. `reviews.ts`: saved
  reviews (`DocumentReview`), newest 5 per document, `contentHash()` (sha256 of the reviewed
  blocks' text, heading levels and footnotes) for staleness. `blocks.ts`: textblocks from the
  stored TipTap JSON (`reviewBlocks()`: what a review sends, measures and hashes; never the
  separately saved plainText; footnotes are left out of a block's text and listed with their
  offsets), and the paragraph numbering both the review prompt and the editor use.
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
  the editor text, heading layout or footnotes differ from what was reviewed). The layout comes
  from `blockLayout()` in `src/lib/editor/locate.ts`, the footnotes from `footnotesLayout()` in
  `blocks.ts`. Also `FootnoteDialog.tsx`, `FootnoteList.tsx` (under the article), `LinkDialog.tsx`,
  `ImportNotice.tsx` (its live region is always rendered) and `ExportMenu.tsx` (a WAI-ARIA menu
  button).
- `src/lib/import/`: in the browser, lazily loaded. `index.ts` (`convertFile()`: extension and
  10 MB checks, FileReader progress, dynamic import of the converter), `docx.ts` (mammoth with a
  style map; its note references and list become footnotes; comments and tracked deletions
  counted from the zip), `markdown.ts` (marked GFM; `[^label]` footnotes; raw HTML rendered as
  text), `text.ts` (blank-line paragraphs), and `html.ts`, where every path ends:
  `htmlToDocument()` parses with DOMParser, `sanitizeImportedDom()` strips and counts, then the
  editor schema converts (a title's footnotes move to a first paragraph of their own).
  `notice.ts`: what was left out, said once in the new document. The
  library POSTs `/api/documents` with title, content and plainText (same limits as PATCH).
- `src/lib/export/`: pure converters from TipTap JSON: `docx.ts` (docx package, lazy;
  `buildDocx()` + `Packer`), `markdown.ts` (CommonMark, escaped; round-trips through the
  importer: formatting whose delimiters would be read as text, by CommonMark's flanking rules
  or marked's quirks, is left off that text), `text.ts`; `filename.ts` (slugs), `download.ts`, `archive.ts` + `protocol.ts` (the
  Settings zip from paginated `GET /api/documents/export`). Print is `@media print` in
  `globals.css` (elements marked `data-print="hide"`).

## Conventions

- Every rule needs unit tests for matches **and** for non-matches (false positives matter more
  than misses; students lose trust in noisy tools).
- Explanations are written to a student, in one or two sentences, and say _why_.
- Never auto-apply changes. The writer always chooses.
- Imported HTML is parsed with DOMParser and the editor schema, never inserted into the live DOM;
  links only allow http, https and mailto.
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
