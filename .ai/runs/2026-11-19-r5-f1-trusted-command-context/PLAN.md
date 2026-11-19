# Plan — r5-f1-trusted-command-context

**Date:** 2026-11-19
**Branch:** feat/r5-f1-trusted-command-context (stacked on #9999 → #9988; PR base `main`)
**Source doc:** .ai/specs/2026-08-14-cart-module.md (§3.1a "Trusted command context (X10)", §15 Phase 4a prerequisites, D-R5-CA8)
**Reference implementation:** closed PR #8268 at bdb747c36a, diff base b7b5309ccc — ported, not redesigned
**Mode:** Spec-implementation run (linked spec), single code Step

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add `buildTrustedCommandContext` (trusted-context.ts + unit test + barrel re-export) | inline | done | (this commit) |

## Goal

Step F1 of the eComm Release 5 re-landing: one shared helper builds every request-less trusted
`CommandRuntimeContext` plus its audit metadata, so no caller hand-rolls the shape.

## Scope

- `packages/shared/src/lib/commands/trusted-context.ts` (new, reference file verbatim)
- `packages/shared/src/lib/commands/__tests__/trusted-context.test.ts` (new, reference file)
- `packages/shared/src/lib/commands/index.ts` — re-export block only

## Non-goals

- Every caller (PR1c, AV2a, CH3, CH4, AS4) — later steps import the helper.
- SA3's `isTrustedSystemCommandContext`.
- No UPGRADE_NOTES.md entry (additive export).

## Must keep

- `actorType: 'system'` → `ctx.systemActor === true`, `ctx.auth === null`.
- `auditMetadata.context` = `{ systemActor: 'system:trusted-context', reason }`.

## Spec findings and decisions concerning this step

- **D-R5-CA8** — import path `@open-mercato/shared/lib/commands/trusted-context`, barrel
  `@open-mercato/shared/lib/commands` as a second entry point (also D-R5-RM6 per the brief). Both
  freeze on merge (BACKWARD_COMPATIBILITY.md: import paths + exported types/signatures).
- **Audit V16** (pre-implement-2026-08-14-cart-module-release-5.md) — helper shape is
  `{ actorType, actorId?, reason }` → `{ ctx, auditMetadata }` at `…/commands/trusted-context`
  (not `trustedContext`); the helper loads **no** ACL — the consumer (`cart`) loads a user
  actor's features via `rbacService`. The reference matches.
- **§3.1a / R22** — no HTTP input may produce such a context. The helper takes no request and sets
  `request: undefined`; enforcement at call sites belongs to the caller steps.
- **Audit V17 / N1** (pay-link tenant assertion) — caller-side (CH3/CA*), not this step.

## Deviations / notes (rule R4: spec wins over card)

- The binding re-landing plan `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` was
  **not present** in the primary checkout, any cezar worktree, or git history. The operator
  instructed the run to proceed autonomously; rules R1–R14 and the card "F1" were therefore not
  read. The step follows the spec text, the D-R5-CA* decisions and the brief's "Must keep" list.
- The spec's §15 slice table has no row labelled "F1" (it lists CA0…CA10b); F1's content is the
  §15 Phase 4a prerequisite line ("the trusted-context helper … (X10, D-R5-CA8)") and §3.1a.
- Card vs spec: no difference found beyond the import path already called out in the brief.
- `.ai/agentic.config.json` `baseBranch` reads `develop` (deleted); the PR targets `main`
  per the brief.

## Gate (narrowed by the brief)

`trusted-context.test.ts`; `yarn typecheck`; `yarn build:packages`. No UI → no integration or
DS pass (recorded in final-gate-checks.md).

## Risks

- Contract freeze on merge: names/shape become public — ported verbatim from the reviewed
  reference to avoid drift with the caller slices.
