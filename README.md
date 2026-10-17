# Polaris

An open-source writing companion for academic writing. Polaris underlines issues as you write (contractions,
wordy phrases, passive voice, citation formatting, and more) and explains each one, so
students learn the conventions instead of just accepting fixes. An **Overview** describes the
draft with transparent writing metrics, and an optional **Review** by Claude gives formative
feedback on the whole document. Drafts come in from Word, Markdown or plain text, can carry
footnotes and links, and go out again as Word, Markdown, plain text or PDF.

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

Upgrading from an earlier version? Run `npm run db:push` again: it adds new tables (such as
the one for saved reviews) without touching your documents. Upgrading a local database created
before accounts existed? `db:push` cannot add the required
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
     request) and the server has an Anthropic key. The same switch covers
     [reviews](#review): asking for a review sends the whole document (footnotes included), its
     title and the writing goals.
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
   | `POLARIS_AI_MODEL`            | `claude-opus-5-5` | The Claude model for suggestions and reviews.    |
   | `POLARIS_AI_PARAGRAPH_EFFORT` | `low`             | `low`, `medium` or `high`: depth versus latency. |
   | `POLARIS_AI_REVIEW_EFFORT`    | `high`            | `low` to `max`: effort for a [review](#review).  |

Suggestions fall into five categories: correctness, clarity, concision, formality and
citations. Citation rules follow the style chosen under **Goals** (APA by default).

The panel beside the editor has three tabs, **Suggestions | Overview | Review** (a WAI-ARIA
tablist: Left and Right move between tabs, Home and End go to the first and last). The browser
remembers the tab you last chose. Selecting an underline in the text always shows its card in
**Suggestions** (without changing the tab the browser remembers). On a phone the panel sits
below the editor.

## Overview

The **Overview** tab describes the draft with a few measures you can check by hand. They are
computed in the browser (nothing is sent anywhere), about 300 ms after you stop typing (or
after you turn a paragraph into a heading or back), and
there is deliberately no single overall score: each number answers one question, and none of
them says whether the writing is good.

| Measure          | What it is                                                                                                                                | Limits                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Words            | Every word, headings included (the footer's count). Footnotes are not counted.                                                            | A word is a run of letters or digits; "well-known" and "it's" are one word each.                                                                     |
| Sentences        | Sentences in paragraphs, split at `.`, `!` and `?` (not after "e.g.", "et al.", "Fig. 2", initials and the like).                         | Headings are not sentences. A list item without a full stop counts as one sentence.                                                                  |
| Paragraphs       | Non-empty blocks that are not headings (list items count).                                                                                |                                                                                                                                                      |
| Reading time     | Words ÷ 200 a minute.                                                                                                                     | A typical pace for academic prose; dense material reads slower.                                                                                      |
| Average sentence | Words per sentence.                                                                                                                       | Academic prose often averages 20 to 25 words; that is a guide, not a rule.                                                                           |
| Sentence variety | The standard deviation of sentence length, in words.                                                                                      | Near 0 means every sentence is about the same length.                                                                                                |
| Longest sentence | Its length in words; the button selects it in the text.                                                                                   | If you have rewritten it since, the panel says so.                                                                                                   |
| Reading ease     | Flesch Reading Ease: 206.835 − 1.015 × words per sentence − 84.6 × syllables per word, with Flesch's bands ("difficult" for 30 to 50).    | Made for general prose. Academic writing usually scores as difficult, and that is normal. Shown from 100 words. Syllables are estimated (see below). |
| Grade level      | Flesch–Kincaid Grade: 0.39 × words per sentence + 11.8 × syllables per word − 15.59, roughly a US school grade (13 and up is university). | Like reading ease, it measures only word and sentence length, not ideas or clarity.                                                                  |
| Passive voice    | The share of sentences in which the passive-voice rule finds a passive ("was measured", "were chosen by").                                | The same heuristic as the rule: it can miss a passive with an unusual participle, and passive is often right in a methods section.                   |
| Word variety     | MATTR (moving-average type-token ratio): the share of different words in every run of 50 words, averaged; plain TTR under 50 words.       | Unlike plain TTR it does not fall just because a text is longer. Repeating key terms is normal in academic writing and lowers it.                    |
| Repeated openers | First words that open 3 or more sentences, the 3 most frequent, with counts.                                                              | Case is ignored. "The" opening many sentences is common; the count is a prompt to look, not a fault.                                                 |
| Suggestions      | What is underlined now in each category (rule and AI suggestions, minus dismissed ones), with a rate per 1,000 words.                     | Counts, not a grade: one long sentence and one typo count the same. The bars are decoration; the numbers carry the meaning.                          |

Syllables are counted with a heuristic, as every readability tool does: groups of vowels,
corrected for a silent final "e" (but not "-le" after a consonant), silent "-es" and "-ed"
endings, a silent "e" before "-ly", "-ment" and similar suffixes, and "ia"/"io" said as two
syllables except in "-tion" and its kin. It is off by one on some words ("created",
"science"), which mostly evens out over a document (`src/lib/text/metrics.ts`).

**Target length.** Set **Target length (words)** under **Goals** (a whole number from 50 to
200,000; optional). The Overview then shows a progress bar with the count in words, such as
"1,240 of 2,000 words (62%)", and the footer shows "1,240 / 2,000 words". Going over the target
is shown as plainly as falling short of it. The target is saved with the other goals, and
reviews mention it only when a draft is far from it.

## Review

The **Review** tab asks Claude for formative feedback on the whole document, written as an
experienced academic-writing instructor would give it: specific, kind and honest, grounded in
your text, without rewriting it or inventing sources. A review has:

- a two- or three-sentence summary of what the document argues, and an assessment of the thesis;
- up to 5 **priorities**, most important first, each with a category (structure, argument,
  evidence, clarity, style or citations) and usually a short quote: selecting the quote finds
  that passage in your text as it is now and selects it (or says "(this passage has changed)");
- up to 4 strengths, up to 8 notes on particular paragraphs or sections (selecting a paragraph
  number jumps to it), and a few sentences each on structure, argument, evidence and style.

Every quote is checked against the reviewed text on the server; a quote that is not really in
it is dropped (the point it belongs to is kept). Nothing is ever applied to your text.

- **What is sent, and when.** Only when you select **Review document** (or **Review again**),
  only with **AI suggestions** switched on in Settings (checked against the database), and only
  if the server has an Anthropic key. Polaris first saves your latest edits, then sends to the
  Claude API: the whole document as saved (every paragraph, numbered `[P1]`, `[P2]`…, its
  headings, also listed as an outline, and its footnotes, marked `[^1]` in the text and listed
  at the end), its title, your writing goals (document type, audience,
  formality, citation style, target length) and its word and paragraph counts. The text is
  marked as the student's writing, to be reviewed and never followed as instructions. Opening
  the tab sends nothing to Claude: it only loads the last saved review from Polaris itself.
- **Length.** From 150 to 60,000 words (and at most 600,000 characters), counted on exactly
  the text that would be sent (footnotes count towards the characters, not the words).
- **Saved with the document.** Polaris keeps the 5 newest reviews of each document (deleted with
  the document or the account), with the model that answered, the prompt version, the word
  count and a SHA-256 hash of the reviewed text, block by block with which blocks are headings
  and the footnotes. When it no longer matches (you edited the text or a footnote, or turned a
  paragraph into a heading or back, which renumbers the paragraphs), the tab says "You have edited the document since this
  review." and offers **Review again**. **Review again** is also there under a review that is
  still current, for when you have changed your writing goals or the title.
- **Model.** The same model as paragraph suggestions (`POLARIS_AI_MODEL`, `claude-opus-5-5` by
  default) at effort `high` (`POLARIS_AI_REVIEW_EFFORT`: `low`, `medium`, `high`, `xhigh` or
  `max`). The answer is streamed (up to 64,000 output tokens, so a long document fits) and
  checked against a schema; counts and lengths are enforced after it arrives. The system
  prompt is marked for prompt caching. A review can take a minute or two; **Cancel** stops it,
  and nothing is saved.
- **Refusals.** As for paragraphs, the request opts in to the server-side refusal fallback
  (not for Haiku). If every model declines, the tab says that Claude declined to review the
  document, and the rest of Polaris carries on.
- **Rate limits.** Per writer, in memory per server process: 6 reviews an hour and 30 a day.
  Requests refused before reaching Claude (too short, AI off) do not count. When a limit is
  reached, the tab says when you can ask again.
- **Privacy.** Polaris never logs document text, prompts or Claude's output; a failed call
  logs only a fixed label, the HTTP status and Anthropic's request id.

## Footnotes and links

- **Footnotes.** **Footnote** in the toolbar (or Ctrl+Alt+F, Cmd+Alt+F on a Mac) puts a
  footnote at the cursor and opens a dialog for its text (plain text, up to 2,000 characters):
  **Save**, **Delete** or **Cancel** (Cancel on a new, empty footnote takes it out again), and
  focus goes back to the text after the marker. Markers show as superscript numbers in document
  order and renumber as you add, move or delete footnotes. Click a marker, or select it with the
  arrow keys and press Enter, to edit it. Under the document a **Footnotes** list shows them in
  order; each entry links back to its marker and has an **Edit** button, and each marker is
  described by its footnote's text for screen readers. Undo and redo work as for any edit: one
  undo takes out a footnote you just added.
- **What footnotes count for.** Footnote text is not part of your prose: the word count, the
  Overview's measures, the saved plain text, the rule-based suggestions and AI paragraph
  suggestions all leave it out (Claude is sent each paragraph without its markers). A
  [review](#review) does read them: they are sent as a numbered list at the end of the
  document, and editing a footnote makes a review stale.
- **Links.** Select text and choose **Link** (or Ctrl+K / Cmd+K) to add, change or remove a link;
  an empty address removes it, and with nothing selected the address itself is added as linked
  text. Web addresses typed or pasted into the text become links on their own. Only `http`,
  `https` and `mailto` links are allowed, whether typed, pasted or imported (`javascript:`,
  `data:`, protocol-relative `//…` and the like are refused); "example.com" gets `https://`. A
  plain click puts the cursor in a link so you can edit its text; Ctrl-click (Cmd-click) opens it
  in a new tab. Links open with `rel="noopener noreferrer nofollow"`.

## Import

**Import** in the library (or dropping a file on it) makes a new document from a file of up to
10 MB. The file is converted **in your browser** and never uploaded; only the document it becomes
is saved, through the same API as any other document. A file that cannot be read shows an error
and creates nothing.

| Format                    | Kept                                                                                                                                                                               | Left out (and counted)                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Word (.docx)              | Title, headings 1–3 (4–6 become 3), paragraphs, bold, italic, underline, strikethrough, bulleted and numbered lists (nested), quotes, links, footnotes and endnotes (as footnotes) | Images, tables, comments, deleted text from tracked changes (insertions are kept as text) |
| Markdown (.md, .markdown) | GitHub-flavoured Markdown: headings, emphasis, strikethrough, code, lists (nested), quotes, links, `[^1]` footnotes with their `[^1]: …` definitions                               | Images and tables. Raw HTML is not trusted: it is kept as visible text, never as markup.  |
| Plain text (.txt)         | Paragraphs (separated by blank lines; single line breaks inside one are soft wrapping); a file with no blank lines gets one paragraph per line                                     |                                                                                           |

The title comes from Word's Title style or the first level-1 heading (taken out of the body),
else from the file name. A title is plain text, so a footnote on it moves to a paragraph of its
own at the start of the text. When something was left out (or a title's footnote moved), the
new document says so once, for example "2 images and 1 table were left out." Every format is turned into HTML that is parsed
with `DOMParser` into a detached document (never inserted into the page), stripped of scripts,
styles, frames, forms and every `on*` and `style` attribute, and then read with the editor's own
schema, so anything the editor cannot show is dropped. Old Word files (.doc) are not supported:
save them as .docx first.

## Export

**Export** in the editor's toolbar exports exactly what the editor shows, named after the title
(`climate-essay.docx`; "untitled" without one):

- **Word (.docx):** the title in Word's Title style, Heading 1–3, bold, italic and underlined text,
  nested bulleted and numbered lists, quotes in an indented Quote style, line breaks, real
  hyperlinks and real Word footnotes, in 12 pt Times New Roman with 1.5 line spacing.
- **Markdown (.md):** CommonMark with everything you typed escaped, nested lists, quotes, links,
  hard breaks, and footnotes as `[^1]` with their definitions at the end. Importing the file
  again gives back the same text (underline aside: Markdown has none). Where Markdown could not
  read formatting back (bold that ends in punctuation right before a letter, as in `Note:` +
  `text`, or in Chinese and Japanese text), that formatting is left off and the text kept.
- **Plain text (.txt):** paragraphs separated by blank lines, list markers kept, footnotes as
  `[1]` in the text and a numbered list at the end.
- **Print / Save as PDF:** the browser's print dialog, with a print stylesheet that shows only
  the title and the document (no navbar, toolbar, side panel or suggestion underlines) in the
  serif font, with page margins, no page break straight after a heading, and the footnotes as a
  numbered list at the end. Choose "Save as PDF" as the printer for a PDF.

## Data export

**Settings → Your data → Download all my documents** downloads a .zip with one Markdown file
per document (named after its title, made unique: `essay.md`, `essay-2.md`) and a
`manifest.json` listing each document's file, title, creation and last-edit dates, word count
and writing goals. Saved reviews and suggestions are not included. The zip is put together in
the browser from `GET /api/documents/export`, which returns the signed-in user's documents with
their content 20 at a time (fewer when they are long: a page stops at about 8 million
characters), so even hundreds of long documents never make one slow or huge request. A user can
ask for 300 pages an hour.

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
- [x] Phase 4: overview panel: transparent writing metrics, suggestion counts and a word target
      (no single overall score, by design)
- [x] Phase 5: whole-document review by Claude (structured, saved per document, quotes that
      jump back into the text)
- [x] Phase 7, part 1: footnotes, links, import (.docx, Markdown, plain text), export (.docx,
      Markdown, plain text, print / PDF) and a data export of every document
- [ ] Phase 7, part 2: polish
