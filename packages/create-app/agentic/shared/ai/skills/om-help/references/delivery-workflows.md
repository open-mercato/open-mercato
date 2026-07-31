# Delivery Workflows

Load this reference when choosing how much planning and automation the request needs.

| Request shape | Workflow |
|---|---|
| Explanation/architecture analysis | Read-only routing + facts/context; report evidence, no writes. |
| Small isolated fix with clear behavior | Domain skill directly; focused regression and validation. |
| Arbitrary one-shot change delivered as PR | External `om-auto-create-pr`; it routes domain work from this harness. |
| Large architectural or three-plus-step capability | External `om-spec-writing`, readiness review, then external auto implementation/PR workflow. |
| Implement existing spec locally | `om-implement-spec`; select explicit phases. |
| Tracker issue end-to-end | External `om-auto-fix-issue`. |
| Review an existing diff/PR | External `om-code-review`/`om-auto-review-pr`. |
| UI/API integration coverage | External `om-integration-tests` with a prepared ephemeral environment. |
| Newly discovered harness miss | `om-evolve-harness`; require a failing semantic case before content edits. |

Escalate from direct work to spec-first when scope crosses independent capabilities, schema/public contracts, providers, auth/security, or multi-module architecture. Do not use process size as a substitute for the domain skill: the delivery workflow still loads every applicable task route.
