# Handoff — 2026-10-14-ecommerce-release-4-write-side

**Last updated:** 2026-10-14T14:30:00Z (Phase 0 checkpoint)
**Branch:** feat/release-4-write-side
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/15 (draft, base `develop` on the fork)
**Current phase/step:** Phase 0 done; resume at Step 1.1
**Last commit:** see `git log` on `feat/release-4-write-side` (Step 0.4 commit, "docs(specs): cross-spec consistency pass...")

## What just happened
- Phase 0 (spec revision, docs-only) is complete: Steps 0.1–0.4 all `done` in PLAN.md's Tasks table.
  - 0.1: `.ai/specs/2026-08-14-cart-module.md` rev 9 — server-derived scope (closes F1/F2), discount mapping fixed (F3/C10), gift lines (F4), lock/convert surface (F7/C6), `token_hash` (C13), `/api/cart/current/*` routes (Q5), re-cut Phase 1–3 gates (W13), `TC-CART-*` ids, new Migration & BC / error-code sections.
  - 0.2: `.ai/specs/SPEC-055-2026-02-23-promotions-module.md` v2.2.0 — the `discountAmountBasis: 'line'` mapping corrected a second time (B.6), `ResolvedEffect.amountNet/amountGross`, standard API-key auth, id-based item addressing, `CodeReservation.cart_id`, row-lock budget enforcement, Release-4 rule set (eleven types), new Public TypeScript Contract / Release 4 Contract Freeze sections, phases re-threaded.
  - 0.3: `.ai/specs/2026-08-21-buyer-scoped-catalog-visibility.md` — header corrected (Phases 1–2 shipped), Phase 3 folded into cart's own Phases 1–3 (new §6.0a ownership table), `evaluateCartVisibility` named with variant-derives-product fix (new risk R11), channel-creation constraint, flagged-line/lock mechanism updated.
  - 0.4: cross-spec consistency pass — no stale `X-Module-Key`/`/carts/:token`/hyphenated-event claims found in `ecommerce-suite-roadmap.md`/`pricing-engine.md`/`storefront-public-api.md`/SPEC-029 beyond what 0.1–0.3 already fixed; added an ADR-7 consequence note (cart's write-path application of "resolved once, at the edge") and fixed ADR-2's stale `catalogPricingService` reference; updated the scope-status file's Status table.
- A concurrent push landed on the branch mid-Step-0.1 (merge of `origin/develop` bringing in #7298, a tax-providers roadmap pointer touching cart §5.2 trigger 5). Merged cleanly. **Re-check `git fetch fork feat/release-4-write-side` before every push** — the branch owner appears to sync `develop` into it concurrently with this run.
- All D-R4-1…29 decisions are now reflected in spec text; per the decisions record's own rule, the record is an audit trail from here on, not the authority — read the specs themselves for Phase 1+.

## Next concrete action
- Step 1.1 (Phase 1 of the overall PLAN, which is SPEC-055's own Phase 1): scaffold the `promotions` module — `index.ts`, `acl.ts` (incl. `promotions.evaluate`/`.codes.redeem`/`.usage.manage`), `events.ts` (underscore ids), `setup.ts`, `di.ts`. No `ce.ts`/`translations.ts`/`search.ts`/`notifications.ts`/`widgets/*`. `Exec: dispatch` per PLAN.md's Tasks table — this is the first candidate for the executor-dispatch pattern (`references/executor-dispatch.md`), since Steps 1.1–1.10 are a coherent sequence inside one module.
- Re-read `SPEC-055-2026-02-23-promotions-module.md`'s revised §Architecture (file tree), §Data Models and new §Public TypeScript Contract before writing code — they are now the ground truth, not the analysis document.

## Blockers / open questions
- None recorded. If a Step needs a decision the D-R4 record doesn't cover, make the smallest conservative choice, write it here and in NOTIFY.md, and continue.

## Environment caveats
- Dev runtime runnable: unknown — not yet needed (no code written).
- Node 24 via `export PATH="/home/bernard/.nvm/versions/node/v24.16.0/bin:$PATH"` (adjust to the local nvm path); fresh-worktree gate order `yarn build:packages` → `yarn generate` → `yarn build:packages`.
- Browser / UI checks: Playwright provider; skip with a logged reason if the dev env cannot start. Not yet relevant (Phase 1 of promotions is domain model + admin, Steps 1.6–1.10 include UI).
- Database/migration state: clean; never run `yarn db:migrate` — `yarn db:generate`, review SQL, keep only the intended migration + that module's `.snapshot-open-mercato.json`.
- Fork repository: `adeptofvoltron/open-mercato`. Pass `-R adeptofvoltron/open-mercato` on every `gh` call (default repo is set, but a fresh shell may not inherit it). Issues are disabled on the fork.
- Gate tasks need `--force` (turbo cache is shared across worktrees).

## Worktree
- Path: this cezar run's own worktree (`.ai/cezar/worktrees/e12a1916-0f76-40d7-a20f-3395d9ab0856`), already checked out at `feat/release-4-write-side`, tracking `fork/feat/release-4-write-side`.
- Created this run: n/a (reused the cezar task's existing worktree).
