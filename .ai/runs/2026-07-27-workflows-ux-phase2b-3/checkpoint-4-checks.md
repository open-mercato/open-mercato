# Checkpoint 4 — after steps 2.6–2.12 (Phase 3a complete)

- Date: 2026-07-28 (UTC)
- Window: commits `36c0dc12b`..`cacf9f7ce` (7 steps)
- Runner: local

## Steps covered

| Step | Commit | Summary |
|------|--------|---------|
| 2.6 | 36c0dc12b | Error routes (`transition.kind: 'error'`) + per-step `errorDirective`; `ERROR_ROUTED`/`ERROR_DIRECTIVE_APPLIED`/`ERROR_PARKED` events; failure-queue park |
| 2.7 | 1fb16413c | Workflow-level error handler as an engine construct (+ `DESIGN-error-handler.md`) |
| 2.8 | 02b836777 | Error output handles, red-dashed DS-token routes with icon pairing, directive + handler pickers |
| 2.9 | abf71b7cc | `InlineRuleEditor` owned by `business_rules`, embedded by the Studio; usage panel via slot |
| 2.10 | 7c0197932 | Route condition/activity/otherwise chips, 3-chip cap + `+N`, semantic zoom collapse |
| 2.11 | 75f75dfe2 | Drag-to-reorder route priority + normalization pass, code-source gated |
| 2.12 | de5c9d631 | Flow-logic + ledger checks wired into the Problems panel; 60-node density fixture |

## Checks

- Scoped suite (`workflows|business_rules`): **1123 suites / 8855 tests passed** (checkpoint 3 was 1111/8728).
- `yarn typecheck`: clean across all 22 workspaces. `yarn lint`: clean. `yarn i18n:check-sync`: in sync.
- `yarn generate` after each module change; tracked enterprise manifest untouched (verified each time).

## Design decisions locked this window

**Workflow-level error handler** (`DESIGN-error-handler.md`, committed) — the spec defined it only negatively, so the design was derived from the engine code:
- **Ordering:** handler scheduled BEFORE compensation. `completeWorkflow`'s FAILED branch returns early after compensating and wraps compensation in a swallowing `try/catch`, so a post-compensation hook would silently not run in exactly the cases a catch-all matters; compensation can also flip the instance to `COMPENSATED`, so only a pre-compensation snapshot describes the failure.
- **Durability:** a queued `workflow_error_handler` job, NOT the durable-FAILED fork (that fork only fires on full transaction rollback, never on the ordinary FAILED path). `ERROR_HANDLER_SCHEDULED` is written inside the failing transaction so intent is durable; the residual crash-between-commit-and-enqueue gap is documented, not papered over.
- **Recursion:** instance `metadata.errorHandler.depth`, capped at 1 — metadata rather than context, because context is writable through the new PATCH API and a context guard would be bypassable by the API shipped in step 2.4.
- **Branches:** instance-level only, after join-failure propagation, at the single `completeWorkflow(FAILED)` choke point; per-branch recovery is the step-level error route.
- **Ask-First: NOT tripped** — no new statuses, no reordered transitions, compensation algorithm and trigger condition unmodified.

**BR dependency visibility (2.9)** — a **slot**, not a lookup: `InlineRuleEditor` exposes `usagePanel?: React.ReactNode` and `business_rules` never learns who consumes it. Workflows fills the slot with its own panel backed by its own tenant-scoped jsonb-containment query. Satisfies the no-cross-import rule by construction and is simpler than a usage-provider registry.

## Backward-compatibility verification (done by the orchestrator, not taken on trust)

- `continueOnActivityFailure` path in `transition-handler` is untouched; when the flag is true the new resolver is never consulted. Regression test read directly: a legacy `continueOnActivityFailure: true` transition still continues, writes nothing to context, and emits no `ERROR_DIRECTIVE_APPLIED`. A second regression asserts a no-error-config definition produces the legacy failure trace with compensation still firing.
- `continueWithFallback` deliberately does NOT flip a FAILED step to COMPLETED (that would be a state-machine change); the step stays FAILED, the instance advances, fallback lands in context under the failing step's id.

## Second pre-existing bug found and fixed (2.12)

`collectBranchingRouteWarnings` counted an **error** route as the otherwise route, silencing the missing-otherwise warning on branching steps that could genuinely stall. Regression test added in `data/__tests__/validators.test.ts`. (The first was the stripped `condition` field, checkpoint 3.)

## Notes

- 2.10 added an inline `condition` field to `EdgeEditDialogCrudForm` — the condition chip had nothing to open, since the dialog only exposed BR-reference pre/post-conditions. Additive; `graphToDefinition` already persisted the field.
- 2.11's route-order UI is scoped to non-branching steps; branching steps already derive priority from their case list, and two competing controls would be worse.
- The 60-node fixture (`examples/oze-residential-install-60-nodes.json`) exercises If/Else, Switch, WAIT_FOR_CONDITION, 3 error routes, both directives, 5 agent touchpoints, and one chip-overflowing route — the spec's density QA exit criterion now has a real target.
- `yarn agents:check-budget` fails on the root `AGENTS.md` size and the `packages/ai-assistant` chain — verified identical with changes stashed, i.e. inherited from the base, not this run.
