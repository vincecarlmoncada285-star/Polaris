# Polaris

An open-source writing companion for academic writing. Polaris underlines issues as you write (contractions,
wordy phrases, passive voice, citation formatting, and more) and explains each one, so
students learn the conventions instead of just accepting fixes.

![Polaris editor with suggestions](docs/screenshot.png)

## Getting started

```bash
npm install
cp .env.example .env
# Set AUTH_SECRET in .env: Auth.js signs session cookies with it, and will not start without it.
openssl rand -base64 32   # paste the output as AUTH_SECRET="…"
                          # (or run `npx auth secret`, which writes it to .env.local)
npm run db:push      # create the local SQLite database
npm run dev          # http://localhost:3000, then create an account at /signup
```

AI suggestions are optional: set `ANTHROPIC_API_KEY` in `.env` to offer them (see
[How feedback works](#how-feedback-works)). Without a key everything else works, and the editor
says that AI suggestions aren’t set up on this server.

`.env` is gitignored; `.env.example` lists every variable and is committed.

Upgrading a local database created before accounts existed? `db:push` cannot add the required
`Document.userId` column to existing rows, so reset it with `npx prisma db push --force-reset`
(this deletes the local documents), then sign up again.

## Scripts

| Command             | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Dev server                                                 |
| `npm run build`     | Production build                                           |
| `npm test`          | Unit tests (Vitest)                                        |
| `npm run test:e2e`  | End-to-end tests (Playwright, fresh `prisma/e2e.db` a run) |
| `npm run lint`      | ESLint                                                     |
| `npm run typecheck` | TypeScript, no emit                                        |

`npm run test:e2e` needs no `.env`: Playwright gives the server a test-only `AUTH_SECRET` and
`AUTH_TRUST_HOST=true`, so it runs as is in CI.

## How feedback works

Polaris uses two layers:

1. **Rules (built).** Fast, deterministic checks in `src/lib/rules/` run on each paragraph
   as you type. Results are cached by paragraph text, so only the paragraph you are editing
   is rechecked.
2. **AI (built, opt-in).** Per-paragraph suggestions from Claude for what rules can't catch:
   hedging and overclaiming, unsupported claims, vague referents ("this", "it"), weak logical
   connections, awkward or ambiguous sentences, register slips and tense inconsistency. They
   show as cards with an **AI** badge and dashed underlines, next to the rule suggestions;
   where the two overlap, the rule's suggestion wins. Claude is told not to repeat what the
   rules already check, never to add facts or citations, and to prefer minimal edits; when a
   fix needs the writer's own judgement it explains what to do instead of offering a
   replacement. Nothing is ever applied without the writer choosing it.
   - **Off unless the writer turns it on.** Nothing is sent to Anthropic unless the writer
     switches on **AI suggestions** in Settings (checked against the database on every
     request) and the server has an Anthropic key.
   - **What is sent, and when.** Only paragraphs the writer writes or changes: opening a
     document sends nothing. A paragraph of at least 8 words (and at most 4,000 characters) is
     sent to the Claude API once the writer has left it unchanged for 1.5 seconds, with the
     writing goals, the document title and the paragraph before it (as context, not to be
     reviewed). Editing one paragraph sends only that one, and text that was already checked
     (after an undo, say) is not sent again. A request is cancelled as soon as its paragraph
     changes again, at most two are in flight, and the paragraph edited last goes first. A
     request that fails is tried again after 30 seconds, then after longer waits. The Settings
     switch says all this before the writer turns it on. Polaris never logs paragraph text,
     prompts or Claude's output.
   - **Model.** `claude-opus-5-5` by default, at effort `low` (paragraph feedback runs often
     and should be quick). Responses use structured outputs and are checked before they are
     shown: at most 6 suggestions, each anchored to text that really is in the paragraph.
   - **Refusals.** Requests opt in to Anthropic's server-side refusal fallback
     (`fallbacks: "default"`): if the model declines a paragraph, the API retries it on a
     fallback model. If every model declines, the paragraph just gets no AI suggestions.
     Haiku models have no server-side fallback, so it is left off for them.
   - **Rate limits.** Per writer, in memory per server process: 30 requests a minute and 600
     a day. Answers served from the cache do not count. When a limit is reached, the editor
     pauses AI suggestions for as long as the server says, and says until when if it is more
     than a few minutes.
   - **Caching.** The server keeps answers in memory for 24 hours (up to 2,000), keyed by a
     SHA-256 hash of the model, effort, prompt version, goals, title, previous paragraph and
     paragraph text; the browser keeps the session's answers by goals and text, so undoing
     back to text that was already checked costs nothing. The system prompt is marked for
     Anthropic's prompt caching.

   | Variable                      | Default           | What it does                                     |
   | ----------------------------- | ----------------- | ------------------------------------------------ |
   | `ANTHROPIC_API_KEY`           | (none)            | Enables AI suggestions. Stays on the server.     |
   | `POLARIS_AI_MODEL`            | `claude-opus-5-5` | The Claude model for paragraph suggestions.      |
   | `POLARIS_AI_PARAGRAPH_EFFORT` | `low`             | `low`, `medium` or `high`: depth versus latency. |

Suggestions fall into five categories: correctness, clarity, concision, formality and
citations. Citation rules follow the style chosen under **Goals** (APA by default).

## Accounts

Each writer has an account, and documents are private to it.

- **Sign-in** is email and password ([Auth.js v5](https://authjs.dev), Credentials provider).
  Emails are stored trimmed and lowercased; passwords (8–128 characters) are hashed with
  bcrypt, cost 12. A wrong password and an unknown email get the same message and take the
  same time, so the form does not reveal who has an account.
- **Sessions** are signed, encrypted JWT cookies (30 days), so there is no session table.
  Signing out clears the cookie on that device. Changing the password does not sign out other
  devices; deleting the account does, as their requests then find no user.
- **Privacy.** Every API route calls `requireUser()` and every query is scoped by user id. Another
  writer's document is a 404, exactly like one that does not exist.
- **Rate limits** (in memory, per server process, sliding windows): 10 sign-in attempts per
  15 minutes per email and IP, plus at most 50 an hour per email from any number of IPs; 5
  sign-up attempts per hour per IP (counted once the form is valid, so a whole class signing up
  behind one school network will hit it); 10 password-change attempts per 15 minutes per
  account.
- **Client IPs and proxies.** Polaris can only tell clients apart by IP when a reverse proxy
  you control reports their address. Without one, `X-Forwarded-For` is whatever the client sent,
  so it is ignored and **all clients share the per-IP limits** (5 sign-ups an hour for the
  whole server, 10 sign-in attempts per email). Behind nginx, Caddy or a load balancer that
  appends the client address to `X-Forwarded-For`, set `TRUSTED_PROXY_HOPS` to the number of
  such proxies (usually `1`), and make sure clients cannot reach Polaris except through them.
- **Settings** (`/settings`): display name, the AI suggestions switch (off by default), password
  change, and account deletion (type your email to confirm; your documents are deleted too).

When self-hosting behind a proxy, keep `AUTH_TRUST_HOST=true` only if the proxy sets the `Host`
and `X-Forwarded-Host` headers itself; otherwise set `AUTH_URL` to the public URL.

### Adding an OAuth provider

The config is split so this stays small. `src/auth.config.ts` is edge-safe (middleware imports
it); `src/auth.ts` adds what needs Node (Prisma, bcrypt) and merges in the providers listed in
`auth.config.ts`. To add GitHub, say:

1. Register an OAuth app with the callback URL `https://<your-host>/api/auth/callback/github`, and
   set `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` (Auth.js reads `AUTH_<PROVIDER>_ID/SECRET`).
2. Add the provider to `providers` in `src/auth.config.ts`: `providers: [GitHub]`, imported from
   `next-auth/providers/github`. OAuth providers need no database, so they are edge-safe.
3. Map the OAuth identity to a Polaris user. Polaris keeps its own `User` table rather than an
   Auth.js adapter, so in `src/auth.ts` override the `jwt` callback: when
   `account?.provider !== "credentials"`, find or create the `User` by the provider's email
   (only if the provider marks it verified) and set `token.id` to that user's id. Make
   `passwordHash` optional in `prisma/schema.prisma` for OAuth-only users, and have
   `verifyCredentials` treat a missing hash as a wrong password. To link accounts by provider
   id rather than email, add an `Account` model (`provider`, `providerAccountId`, `userId`),
   or switch to `@auth/prisma-adapter`.
4. Add a "Continue with GitHub" button to `/signin`: a form whose server action calls
   `signIn("github", { redirectTo })`, with `redirectTo` passed through `sanitizeCallbackUrl`.

## Roadmap

- [x] Phase 1: editor, document CRUD, autosave
- [x] Phase 2: rule engine, underlines, suggestion cards, writing goals
- [x] Phase 6 (built early, so the AI routes are written auth-aware): accounts, private
      per-user documents, settings. The database stays SQLite, which suits a single self-hosted
      server; for serverless hosting, whose filesystem does not persist, change `provider` in
      `prisma/schema.prisma` to `"postgresql"` and point `DATABASE_URL` at a Postgres server.
- [x] Phase 3: LLM suggestions (schema-validated, cached, cancellable)
- [ ] Phase 4: overview panel and scores
- [ ] Phase 5: whole-document review
- [ ] Phase 7: import/export (.docx, Markdown), polish
