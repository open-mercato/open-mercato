# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-05-28T19:12Z
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** COMPLETE — Phases 16–20 all done. Command-level OSS optimistic locking shipped + wired for sales + docs/specs updated + follow-up issue #2215 filed. Final gate green (locally runnable subset); CI authoritative for build:app + integration. Next: human re-QA + 2nd-approver merge.
**Last code commit:** b2d94520f (`feat(sales): send document version header on quote convert`) — docs in d8dcee93c.

## What this resume adds (Phases 16–20)

New scope on top of the previously-`complete` PR, per the user's directive:
a **generalist command-level** OSS optimistic-lock mechanism (not just
CrudForm/makeCrudRoute), implemented for sales, plus docs/spec + a follow-up
issue for other modules.

- **Phase 16 (done, `7d30ee397`):** `packages/shared/src/lib/crud/optimistic-lock-command.ts` — `readOptimisticLockExpected`, `assertOptimisticLock`, `enforceCommandOptimisticLock`. Exported `normalizeIsoToken` from `optimistic-lock.ts` so command + CRUD paths normalize identically. 57 unit tests.
- **Phase 17 (done, `d6448082e`):** sales-local `enforceSalesDocumentOptimisticLock` in `commands/shared.ts`; wired into order/quote line + adjustment upsert/delete, return create, and quote→order conversion (closes #2114 race). Parent order/quote version is the consistency boundary; its `updated_at` bumps automatically because these commands recalc document totals → dirty the parent. Payments/shipments left to their existing makeCrudRoute row-level guard.

## Key architectural finding

The CRUD factory only runs the row-level optimistic guard when `candidateId`
(`input.id`) is set. `makeSalesLineRoute` returns `{ body: payload }`, nulling
`candidateId`, so lines/adjustments have NO row-level guard — the new
command-level document-aggregate check is their sole guard (no double-409).
Payments/shipments use flat mapInput (top-level `id`) → row-level guard fires →
left as-is.

## Next concrete action (Phase 18)

Wire the sales document UI sub-resource sections (ItemsSection, AdjustmentsSection,
ReturnsSection, convert action) to send `buildOptimisticLockHeader(document.updatedAt)`
via `withScopedApiRequestHeaders(...)` on their POST/PUT/DELETE, and surface the
409 conflict flash (`ui.forms.flash.recordModified`) + refresh. The document
detail page (`backend/sales/documents/[id]/page.tsx`) loads the document — confirm
it exposes `updatedAt` to the sections. Then Phase 19 (docs/spec), Phase 20
(follow-up issue + final gate + auto-review + summary).

## Blockers / env caveats

- Command-level tests importing `../documents` need `yarn build:packages` + `yarn generate` first (transitive `@open-mercato/cache` + `#generated/*`). Both run green.
- Real typecheck: `yarn turbo run typecheck --filter=@open-mercato/core` (root tsc 6.0.3, green). The workspace `yarn workspace … typecheck` fails on a pre-existing `ignoreDeprecations` env issue (tsc 5.9.3) — ignore it.
- Playwright/integration not runnable locally (no PG/Redis). CI ephemeral is authoritative.
- `gh` at `~/.local/bin` — `export PATH="$HOME/.local/bin:$PATH"` each fresh Bash.
- Janitor autosave commits interleave; collapse with `git reset --soft <pushed-base>` then re-commit cleanly. Repo squash-merges so the noise is harmless; do NOT force-push the shared PR branch.

## Worktree

Path: `/home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/62b06a07-855f-4863-b5a7-264a44e95c5f/` (janitor task worktree, on branch `task/62b06a07-…` reset to the PR head). Push via `git push origin HEAD:feat/oss-optimistic-locking`.
