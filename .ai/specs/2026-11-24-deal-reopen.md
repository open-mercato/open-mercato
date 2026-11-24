# Reopen a closed CRM deal

Extends: .ai/specs/2026-10-22-crm-deal-closure-integrity.md

## 📝 TLDR

CRM operators need to recover deals closed by mistake. Add a **Reopen deal** action on the deal detail page. Operators with `sales.reopen` can return a closed deal to an open stage in its current pipeline.

## 📝 Problem Statement

The Lost confirmation refers to `sales.reopen`, but Customers registers no such permission. The detail page renders the Close deal control for open deals and offers no equivalent action for closed deals. [Issue #4330](https://github.com/open-mercato/open-mercato/issues/4330)

The closure integrity spec describes reopening through a stage transition. Current code can accept ordinary status updates, but has no permission-gated action that updates the status, stage and stored loss details together. The tenant vocabulary and actual close-date work have independent delivery paths. Use the shipping status classifier and leave the forward integration to those changes. [Status vocabulary PR #9815](https://github.com/open-mercato/open-mercato/pull/9815) · [Actual close-date spec PR #10547](https://github.com/open-mercato/open-mercato/pull/10547)

Dynamics 365 uses a record-level Reopen Opportunity action. The same placement fits the existing deal detail header, where the operator can see the current outcome before acting. [Dynamics 365 Sales guidance](https://learn.microsoft.com/en-us/dynamics365/sales/close-opportunity-won-lost-sales#reopen-a-closed-opportunity)

## Resolved assumptions (autonomous defaults)

| Question | Default | Rationale |
| --- | --- | --- |
| Which stage receives the deal? | Let the operator choose an open stage in the current pipeline. A deal without a pipeline can reopen without a stage. If the pipeline has no open stage, explain why reopening is unavailable. | The chosen stage reflects where the work should resume. |
| What does the permission cover? | Require both `customers.deals.manage` and `sales.reopen` for the dedicated action. Keep the permissions of existing generic deal update calls. | The issue asks for a gated action. Integrations already use generic status updates. |
| Who receives the new grant? | Include it in the Customers admin defaults. Other roles can receive it explicitly. Existing wildcard grants resolve through standard ACL rules. | Administrators can delegate the action without granting additional access to every user who can edit deals. |

## 📝 Delta

### Capability: crm-deal-reopen

#### ADDED Requirement: Reopen a closed deal from its detail page

The system SHALL let an authorized operator move a closed deal to an open stage in its current pipeline.

##### Scenario: Reopening a closed deal

- WHEN a user with both permissions confirms a valid destination for a closed deal
- THEN the deal becomes open in that stage, its current closure outcome and loss details clear, and its forecast close date is preserved

##### Scenario: Reopen permission is absent

- WHEN a user can edit a deal but lacks the reopen grant
- THEN the detail page hides Reopen deal and the reopen endpoint rejects the request

##### Scenario: The supplied version is stale

- WHEN the deal has changed since the operator loaded it
- THEN the action returns the standard optimistic-lock conflict and offers refresh

#### MODIFIED Requirement: Lost confirmation describes how to recover a deal

The confirmation SHALL describe the Lost transition and the availability of the dedicated Reopen deal action to authorized users.

##### Scenario: Confirming a loss

- WHEN an operator opens the Lost confirmation
- THEN the warning refers to the Reopen deal action and its permission

Frozen by: `packages/core/src/modules/customers/__integration__/TC-CRM-4330-deal-reopen.spec.ts`

## 📝 Architecture

The Customers module owns the action. Register the requested `sales.reopen` identifier in the Customers ACL registry so the deal workflow also works in deployments that omit the Sales module. Require both grants in the API metadata and the detail header. Use the effective staff features returned by backend chrome for UI visibility. The request's authenticated tenant and authorized organization filters govern both deal and destination queries.

Reuse the deal update command's write and undo logic with a server-side reopen intent. The ordinary deal input schema remains compatible. Within the write transaction, check the version and eligibility on the freshly locked deal row before changing it. Share the deal detail's terminal-stage label classifier with the server. A closed deal has an explicit outcome or a recognized terminal status, including legacy aliases. A neutral `closed` deal is eligible only through explicit operator confirmation. Undo uses the existing deal audit path to restore the previous state. A reopening emits the normal update and applicable stage transition side effects. Existing won/lost events continue to follow closure transitions.

## 📝 API Contracts

Add `POST /api/customers/deals/reopen` with `{ id: UUID, pipelineStageId: UUID | null }` and a success response of `{ ok: true }`. Use a Zod schema and publish the OpenAPI operation. Treat this write as an update in the mutation-guard registry. Validate the effective guarded payload or constrain it to the same action schema. A destination must resolve within the deal's tenant, organization and current pipeline. Clear the active outcome, loss reason and notes by setting the fields explicitly. A pipeline-free deal uses a null destination, with any legacy stage label cleared on the reopened record.

Use the same effective-pipeline resolver as deal detail to handle legacy stage IDs and labels. For those deals, stage selection uses the resolved pipeline and persists the canonical assignment. The action rejects invalid or terminal destinations, refuses records outside the authorized scope, and returns the platform's standard conflict shape for a stale version. Repeated submission after the record is open returns a state conflict without a second transition. Apply the command optimistic-lock check against the current deal and return operation metadata for the existing undo action.

## 📝 UI/UX

Use the same closed-deal classifier to show **Close deal** for open deals or **Reopen deal** for eligible closed deals in the header action slot. Reuse the shared dialog, controls and existing detail stage data. List open stages from the current pipeline. Require a destination when the deal has a pipeline. The dialog supports Escape, Cmd/Ctrl+Enter and the existing unsaved-edit confirmation. During submission disable the primary action. Refresh the detail, show a localized success message and report failures in the dialog or via the shared conflict UI. Translate the warning, action, dialog and errors for all shipped Customers locales.

The deal detail page owns client state and uses the guarded mutation runner, scoped optimistic-lock header and shared API helper. The new API keeps record reads, authorization and writes on the server. The flow adds no global provider or initial fetch. Verify keyboard behavior and a settled header in the native browser test.

## Migration & Backward Compatibility

The endpoint and ACL feature are additive. Existing CRUD, import, AI and Kanban callers keep their current request and authorization contracts. The permission protects the dedicated action. The Lost dialog copy describes that specific action. There is no schema or data migration. Existing tenants can assign the new feature through role settings or sync the updated admin defaults with `yarn mercato auth sync-role-acls`. Existing `sales.*` and `*` grants can match the new ID. `customers.*` grants deal management and requires a separate reopen grant.

## 📝 Integration coverage

Add self-contained fixtures and cleanup in `TC-CRM-4330-deal-reopen.spec.ts`. Cover a won and a legacy lost deal, an open stage selection, closure-field reset, an inferred legacy pipeline, a pipeline-free deal, persistence after reload, and undo. Exercise an ordinary deal update to confirm compatibility. Verify hidden UI and HTTP denial for a deal editor without the feature, mismatched stages, cross-scope IDs, stale versions, concurrent and sequential duplicate submissions and an all-terminal pipeline. Use the existing customer deal and ACL fixture helpers.

## Design review

Independent scope review confirmed one independently shippable capability. The review identified the need for a server-only intent, a fresh row lock, shared pipeline resolution and a single classifier for the header actions. Those requirements are reflected above. Runtime validation is listed in the implementation plan.

## 📋 Implementation Plan

### Phase 1 — Ship the detail action

1. Characterize the current Lost warning in a browser test on the unchanged application.
2. Register the permission and wire the scoped, guarded endpoint through the deal update command. Add focused validation and native API coverage for eligibility, scoping, versioning and the returned state.
3. Wire the deal detail action and localized dialog. Update the characterization test and cover denial, keyboard submission, refresh and the empty destination state.
4. Archive the Delta into `.ai/specs/capabilities/crm-deal-reopen.md` and record native QA for the completed flow.
