# Polaris

An open-source writing companion for academic writing. Polaris underlines issues as you write (contractions,
wordy phrases, passive voice, citation formatting, and more) and explains each one, so
students learn the conventions instead of just accepting fixes.

![Polaris editor with suggestions](docs/screenshot.png)

## Getting started

```bash
npm install
cp .env.example .env
npm run db:push      # create the local SQLite database
npm run dev          # http://localhost:3000
```

## Scripts

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Dev server                                 |
| `npm run build`     | Production build                           |
| `npm test`          | Unit tests (Vitest)                        |
| `npm run test:e2e`  | End-to-end tests (Playwright, separate DB) |
| `npm run lint`      | ESLint                                     |
| `npm run typecheck` | TypeScript, no emit                        |

## How feedback works

Polaris uses two layers:

1. **Rules (built).** Fast, deterministic checks in `src/lib/rules/` run on each paragraph
   as you type. Results are cached by paragraph text, so only the paragraph you are editing
   is rechecked.
2. **AI (planned, Phase 3).** Per-paragraph suggestions from Claude for issues rules can't
   catch, such as hedging, argument flow, and unsupported claims.

Suggestions fall into five categories: correctness, clarity, concision, formality and
citations. Citation rules follow the style chosen under **Goals** (APA by default).

## Roadmap

- [x] Phase 1: editor, document CRUD, autosave
- [x] Phase 2: rule engine, underlines, suggestion cards, writing goals
- [ ] Phase 3: LLM suggestions (schema-validated, cached, cancellable)
- [ ] Phase 4: overview panel and scores
- [ ] Phase 5: whole-document review
- [ ] Phase 6: accounts, PostgreSQL
- [ ] Phase 7: import/export (.docx, Markdown), polish
