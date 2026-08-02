# Delivery Workflows

Load this reference when choosing how much planning and automation the request needs.

| Request shape | Workflow |
|---|---|
| Explanation/architecture analysis | Read-only routing + facts/context; report evidence, no writes. |
| Small isolated fix with clear behavior | Domain skill directly; focused regression and validation. |
| Arbitrary one-shot change delivered as PR | External `om-auto-create-pr`; it routes domain work from this harness. |
| New user-facing/platform capability, architecture, schema/API contract, cross-module, or multi-phase behavior | Reuse/amend one covering spec; otherwise external `om-spec-writing`, readiness review, then implementation. |
| New feature with an explicit current-request skip/bypass | Acknowledge the override and continue directly; urgency or “small feature” wording is not a bypass. |
| Materially ambiguous change after repository inspection | Ask one bounded classification question. |
| Implement existing spec locally | `om-implement-spec`; select explicit phases. |
| Tracker issue end-to-end | External `om-auto-fix-issue`. |
| Review an existing diff/PR | External `om-code-review`/`om-auto-review-pr`. |
| UI/API integration coverage | External `om-integration-tests` with a prepared ephemeral environment. |
| Newly discovered harness miss | `om-evolve-harness`; require a failing semantic case before content edits. |
| Share this completed harness run for upstream improvement | `om-share-this-session`; prepare locally, pass privacy review, then require fresh informed consent before any public write. |

Before implementation planning, search `.ai/specs/` once. Reuse or amend one covering spec instead of creating a duplicate. Bug fixes, minor behavioral corrections, small docs/config changes, dependency maintenance, and isolated refactors without new architecture/public contracts proceed directly. A new feature skips spec-first only when the user's current request explicitly says to skip or bypass it; silence and earlier preferences do not carry authority into the current turn. Do not use process size as a substitute for the domain skill: the delivery workflow still loads every applicable task route.
