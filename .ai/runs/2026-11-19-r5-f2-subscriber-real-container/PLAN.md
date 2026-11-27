# Plan — r5-f2-subscriber-real-container

**Date:** 2026-11-19
**Branch:** feat/r5-f2-subscriber-real-container (stacked on #9998 → #9988; PR base `main`)
**Source doc:** .ai/specs/2026-03-19-checkout-simple-checkout.md (§11 "real container", §12 Background jobs — `recover-stuck-submits`, §17 CH4/CH5b prerequisite "the container hand-off")
**Reference implementation:** closed PR #8268 at bdb747c36a, diff base b7b5309ccc — ported, not redesigned
**Mode:** Spec-implementation run (linked spec)

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add `buildScopedContainerFromResolve` shim + unit test | inline | done | e5ea1a394d |
| 1 | 1.2 | Hand the real container to subscribers and worker jobs (events, cli, bootstrap) | inline | done | f1814e2330 |
| 1 | 1.3 | Promotions DI container-scope test | inline | done | 9beaba826e |
| 2 | 2.1 | RL-11: no reminder e-mail for the create-time `forms.invitation.sent` | inline | done | a740cfc093 |
| 2 | 2.2 | TC-FORMS-EXP-010 snapshot filter, example comment, UPGRADE_NOTES | inline | done | 7ffdde24fe |
| 2 | 2.2-review-fix | Correct the forms pre-change behaviour in UPGRADE_NOTES; record the register() caller risk | inline | done | (this commit) |

## Goal

Step F2 of the eComm Release 5 re-landing: event subscribers (inline and queued) and queue worker
jobs receive the real DI container (`ctx.container`), so command code that calls
`container.register(...)` works there; `buildScopedContainerFromResolve` is the fallback for a
caller that only holds a bound `resolve`.

## Scope

- `packages/shared/src/lib/di/scopedContainer.ts` + `__tests__/scopedContainer.test.ts` (new, reference verbatim)
- `packages/events/src/types.ts`, `bus.ts`, `modules/events/workers/events.worker.ts`;
  `packages/cli/src/lib/worker-job-handler.ts`; `packages/core/src/bootstrap.ts` — whole reference hunks
- `packages/core/src/modules/promotions/__tests__/promotionsDiContainerScope.test.ts` (new)
- `packages/core/src/modules/forms/__integration__/TC-FORMS-EXP-010.spec.ts` — `kind: 'snapshot'` filter
- Stale comment in `apps/mercato/src/modules/example/subscribers/example-event.ts` + create-app template twin
- RL-11 (beyond the reference): `forms/events-payloads.ts`, `forms/commands/invitation.ts`,
  `forms/subscribers/invitation-email.ts` + unit test
- `UPGRADE_NOTES.md` entry

## Non-goals

- Callers of `register` / of the shim (CH5b, AS4).
- Any other reference hunk.

## Must keep

- `asValue` unwrapping in the shim.
- The real container on all four paths (bus `deliver()`, bus `dispatchQueued()`, events worker,
  per-job worker handler); the shim is the caller-side fallback.
- `container ?? opts.container` in `dispatchQueued`.
- `container` on the per-job ctx only when the factory's container has `register`.

## Spec findings and decisions concerning this step

- **Audit finding (pre-implement-…-release-5.md, row "Subscribers and workers dispatch commands
  without a real container", review R27–R29, Medium)** — B.4 depends on the container hand-off
  (`SubscriberContext.container`, `WorkerJobContainer.register`). This step delivers it.
- **§11** — subscribers and workers that execute commands use a real request container
  (`SubscriberContext.container`, `WorkerJobContainer`), never a bare `em`. **§12** — every worker
  "runs commands with a real container (§11)"; `recover-stuck-submits` is the first consumer (CH5b).
- **§17** — CH4 lists "the container hand-off (shared)" and CH5b "the container hand-off for
  workers" as prerequisites. No D-R5-CH* decision concerns this step directly; D-R5-CH7
  (trusted context) is F1's.

## Deviations / notes (rule R4: spec wins over card)

- The binding re-landing plan `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` was
  **not present** in the primary checkout, any cezar worktree, or git history. The operator
  instructed the run to proceed autonomously; rules R1–R14 and the card "F2" were therefore not
  read. The step follows the spec text and the brief's scope / "Must keep" list.
- The spec has no step row labelled "F2" in §17, and §3.3/§14a carry no container row; F2's
  content is the CH4/CH5b prerequisite line and §11/§12. No card-vs-spec difference found.
- `SubscriberContext.container` is additive and optional; no §14a row exists for it — recorded
  in UPGRADE_NOTES.md instead.

## Behaviour changes (heads-up for `forms`)

Three `forms` subscribers read `ctx.container` and silently did nothing before (no container was
passed): `forms-pdf-snapshot` (PDF snapshot attachment on submit), `forms-consent-projector`
(consent records) and `invitation-email` (reminder e-mail). With the real container they run.
RL-11 keeps `invitation-email` from sending a reminder right after the create-time personal-link
e-mail: the create path marks its emit `source: 'create'`.

## Gate (narrowed by the brief)

`scopedContainer.test.ts`, `promotionsDiContainerScope.test.ts`, the RL-11 unit test, the
`packages/events` and `packages/cli` suites, `yarn typecheck`, TC-FORMS-EXP-010.

## Risks

- risk-high: every subscriber/worker gets a new context field; the three `forms` subscribers start
  running in production.
- Review finding (Low, for CH5b/AS4): an inline subscriber's `ctx.container` is the container that
  bootstrapped the bus, which with `OM_BOOTSTRAP_CACHE` or the global bus may not be the current
  request's. `register({ auth })` directly on it would persist the override, so callers should
  `createScope()` first or use the per-job worker container.
