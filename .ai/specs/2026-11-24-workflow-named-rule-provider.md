# Business Rules provider for named workflow rules

Extends: .ai/specs/2026-07-26-workflows-ux-redesign.md

## TLDR

Workflows resolves named START and transition rules through the existing Business Rules service. Inline conditions and the current module requirement keep their existing behavior.

## Resolved assumptions (autonomous defaults)

Keep the existing `workflows → business_rules` hard requirement and the pure inline evaluator. Deciding whether to make the module optional stays in #9217 item 8. The named-rule service cutover can be verified independently of that decision and of credential issuance.

## Overview

This is the Business Rules part of workstream 2 of [#10476](https://github.com/open-mercato/open-mercato/issues/10476). Implement after [#10129](https://github.com/open-mercato/open-mercato/pull/10129). Coordinate guard-rule seed ownership with [#6733](https://github.com/open-mercato/open-mercato/issues/6733) D06 and preserve the decision gate in [#9217](https://github.com/open-mercato/open-mercato/issues/9217).

## Problem Statement

#10129 adds a missing-provider guard for START rules. START and transition pre- and post-conditions still directly import the stored-rule engine. Named rules have persistence and action side effects owned by Business Rules, while inline expressions reuse a pure evaluator. [START](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/core/src/modules/workflows/lib/start-validator.ts#L139-L179) · [Transitions](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/core/src/modules/workflows/lib/transition-handler.ts#L950-L996)

## Proposed Solution

Reuse the owner-registered `ruleEngine`, following Mercato's existing process DI boundary. [Provider operation ownership](https://developer.hashicorp.com/terraform/plugin/framework/providers)

## Architecture

- Use the existing Business Rules `ruleEngine` registration from `business_rules/di.ts` through a narrow interface for named execution. Resolve in each established execution context and pass the current EntityManager, tenant/org, actor and rule options unchanged. Leave rule action dispatch and persistence with Business Rules.
- Thread the runner into `validateWorkflowStart`, its route and `workflow-executor.ts`, and into named transition evaluation through the existing transition execution context. Existing two-argument `validateWorkflowStart` callers continue working by resolving the owner from the already bootstrapped container at the server boundary. An explicitly unavailable capability remains unavailable within the supplied scope.
- Pin START's required-rule refusal and optional-rule skip. Characterize named transition pre/post failure and optionality before editing, and preserve transition control flow when the provider is registered. For an unexpectedly missing registration, never treat an unevaluated required precondition as passed. Precondition rejection and any postcondition failure use the established transition failure path for their phase. Preserve dry-run suppression of rule side effects.
- Preserve the existing pure evaluator/schema dependencies for inline expressions and the current hard module requirement. Remaining seed and CLI persistence migrations are coordinated with #6733 D06.

## Data Model

No new entities, fields or migrations. Saved rule IDs, workflow definitions and rule execution records retain their identity.

## API Contracts

Keep `POST /api/workflows/instances/validate-start`, existing start/execution paths, their authorization and existing result shapes. Honor required and optional conditions in the phase where they run.

## Migration & Backward Compatibility

Retain the `ruleEngine` DI key and two-argument validation entry point. Any added runtime-context parameter is optional. Existing rule definitions require no migration. Rollback uses the previous call path over the same rows. Completed rule side effects keep existing recovery semantics.

## Risks & Impact Review

| Risk | Mitigation and residual risk |
|---|---|
| High — a missing provider lets a required transition pass or changes dry-run effects. | Characterize and pin START and transition policy first. Test absent registration, current rule/actor/options handling and dry-run suppression. |
| Medium — rule-free or inline-only instances begin depending on provider resolution. | Resolve the named-rule service only for named rules, and exercise rule-free and inline-only workflows with isolated fixtures. |

## Phasing

Characterize and migrate START and named transition rules in one implementation PR. Keep required and optional semantics testable after each cutover.

## Implementation Plan

1. Pin START validation, actual start and transition pre/post behavior before editing. Extend the START `TC-WF-9217` scenario and add transition fixtures.
2. Route START and named pre- and post-transition rules through DI. Exercise required, optional, unknown and disabled rules, provider errors, dry-run, no-rule and inline-only routes. Verify that other tenant and organization fixtures are unaffected.
3. Verify the normal app generates with its current requires graph. Cover a missing runner in a test composition and preserve the existing public validation surface.

## Final Compliance Report

Reviewed provider direction, scope and actor propagation, dry-run behavior, and backward compatibility. Runtime and failure coverage belong to the implementation PR.

## Changelog

- 2026-11-24 — Proposed Business Rules-owned named execution for #10476.
- 2026-11-24 — Routed named START and transition rules through the active `ruleEngine` registration. Kept two-argument START validation and suppressed START rule actions for dry runs.
