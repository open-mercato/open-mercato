# Final gate — ts-morph module fact-sheets (all 21 steps done)

**Fired:** 2026-06-30T16:25:00Z
**Branch:** feat/ts-morph-module-fact-sheets @ HEAD (post-4.2)
**Nature of change:** docs + build-tooling + tests. No runtime/UI/API/DB-schema surface (spec §9: "API Contracts: N/A — no runtime HTTP surface added or changed"; §10: integration coverage = unit/snapshot tests + a build guard, "No HTTP routes or UI flows are added").

## Gate results

| Check | Result |
|-------|--------|
| `yarn build:packages` | ✅ 21/21 tasks (cli, core [3429 entrypoints], create-mercato-app [9 fact-sheets], all packages) |
| `yarn generate` | ✅ exit 0, "All generators completed"; **versioned `apps/mercato/src/module-facts.generated.json` has ZERO drift** (generate-wired extractor matches the committed artifact — D4 validated). Structural cache purge skipped (no local Postgres) — tolerated/non-fatal. |
| `yarn i18n:check-sync` | ✅ all 4 locales in sync across 48 modules (no churn from this change) |
| `yarn workspace @open-mercato/cli typecheck` | ✅ exit 0 |
| `yarn workspace @open-mercato/cli test -- module-facts` | ✅ 29 tests (T1–T4) |
| `yarn workspace create-mercato-app typecheck` | ✅ exit 0 |
| `yarn workspace create-mercato-app test` | ✅ 68 tests (incl. T5 build smoke + T6 module-guides), 0 fail |
| No lingering source refs to deleted guides / legacy `core.<module>.md` | ✅ none in `packages/create-app/{agentic,src}` |

## Deferred to PR CI (environment-heavy or N/A for this change)

- `yarn build:app` — Next.js app build is heavy and this change touches no app runtime surface (only docs/build-tooling/tests). CI covers it.
- `yarn test:integration` / `yarn test:create-app:integration` — **N/A per spec §10** (generator + docs; no HTTP routes or UI flows). `test:create-app:integration` additionally needs a Verdaccio publish + full scaffold install (CI-only). CI covers.
- **ds-guardian** — the diff contains **zero `.tsx`/UI changes** (only `.ts`/`.mjs`/`.md`/`.json`); no design-system surface to evaluate.
- Formal `om-auto-review-pr` autofix pass — a self code-review + BC self-review were done instead (below); a formal review can run on the PR.

## Self code-review (om-code-review + BACKWARD_COMPATIBILITY.md)

- **Generated-file contract (BC):** the 9 deleted `core.<module>.md` legacy names are bridged — build.mjs emits thin redirect stubs while the new fact-sheets land; deprecation + migration documented in `RELEASE_NOTES.md`. Verified post-4.1 clean rebuild writes exactly 9 stubs. ✅
- **Additive surfaces:** create-app gained `@open-mercato/cli` (build-time devDep) + `ts-morph` (runtime dep, user-approved); `shared.ts` exports 3 helpers (additive); build.mjs adds steps; AGENTS.md.template static table → marker block (template content, not a frozen contract). No removed/renamed exports, event IDs, routes, DI names, or ACL features. ✅
- **No `any`, typed throughout; no user-facing strings; no tenant/encryption/runtime code touched.** ✅
- **R5 fallback** (empty/unparseable enabled set → full bundled set) covered by T6. **Anti-drift** (real customers facts incl. cli=4/tableIds=3, not the stale spec §6 example) locked by T1. ✅

## Residual / follow-ups (non-blocking)
- `build.mjs` does not `rm -rf` the guides dir before regenerating; a stale incremental dist could retain a removed full guide instead of its stub. CI/publish builds are clean checkouts (no staleness); flagged as a minor robustness follow-up.
- Soft gap from checkpoint 1: `tableIds=0` for catalog/integrations/sales (host-token extractor targets specific DataTable literal patterns) — non-blocking.
- Spec §10 T1 row text still says "empty cli" (the stale example this feature exists to catch); the real T1 locks cli=4. Optional doc nit in the spec.

## Verdict
PASS (feasible gate). The feature is complete and green across build, generate (no artifact drift), i18n, typecheck, and all unit/snapshot/wiring tests (T1–T6). Heavy CI gates (build:app, integration) and a formal review are left to the PR per the change's docs+tooling nature.
