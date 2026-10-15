# Polaris: notes for Claude

Academic writing assistant. Next.js 15 (App Router) + TypeScript (strict) + Tailwind v4 +
TipTap 2 + Prisma (SQLite locally) + Vitest + Playwright.

## Commands

- `npm test`: unit tests. Run them before every commit.
- `npm run test:e2e`: builds and serves on :3100 against `prisma/e2e.db`.
- `npm run typecheck && npm run lint`

## Layout

- `src/lib/rules/`: the rule engine. Pure functions over a paragraph's plain text; no editor imports.
  - `builtin.ts`: rules. Add a rule there, then add it to `BUILTIN_RULES` (order = overlap priority).
  - `engine.ts`: runs rules, resolves overlaps, LRU cache keyed by context + text.
- `src/lib/editor/`: ProseMirror bridge. `textblocks.ts` maps text offsets to doc positions
  (inline atoms count as U+FFFC); `suggestions.ts` is the TipTap extension (decorations,
  dismissals, apply).
- `src/lib/documents/`: zod schemas + service (takes a PrismaClient, so tests use a temp DB).
- `src/lib/autosave.ts`: debounced, serialized saver.
- `src/components/`: React UI.

## Conventions

- Every rule needs unit tests for matches **and** for non-matches (false positives matter more
  than misses; students lose trust in noisy tools).
- Explanations are written to a student, in one or two sentences, and say _why_.
- Never auto-apply changes. The writer always chooses.
- Accessibility: every control needs an accessible name; colour is never the only signal
  (cards carry the category label).
- Keep `ANTHROPIC_API_KEY` server-side only. Never log document text.
