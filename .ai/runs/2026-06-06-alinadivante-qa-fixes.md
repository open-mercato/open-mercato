# alinadivante QA fixes

## Overview

Goal: fix the remaining regressions reported by `alinadivante` in GitHub issue comment `4634643036` for issue `#2529`, then cover the fixes with executable integration tests.

Source issue comment: https://github.com/open-mercato/open-mercato/issues/2529#issuecomment-4634643036

Affected areas:
- Checkout template edit validation in `packages/checkout/src/modules/checkout`.
- Customers people-v2 and companies-v2 phone clearing in `packages/core/src/modules/customers`.
- Integration coverage under module-local `__integration__` folders.

Guides read:
- Root `AGENTS.md` task router.
- `packages/checkout/AGENTS.md`.
- `packages/core/AGENTS.md`.
- `packages/core/src/modules/customers/AGENTS.md`.
- `packages/ui/AGENTS.md`.
- `packages/ui/src/backend/AGENTS.md`.
- `.ai/qa/AGENTS.md`.
- `BACKWARD_COMPATIBILITY.md`.
- `.ai/lessons.md`.

Relevant specs checked:
- `.ai/specs/implemented/2026-03-19-checkout-pay-links.md`.
- `.ai/specs/implemented/2026-04-12-customers-people-nested-profile-update-contract.md`.
- `.ai/specs/implemented/SPEC-046-2026-02-25-customer-detail-pages-v2.md`.

## Scope

Fix only the two failed QA cases:
- Editing an existing Checkout Template must reject a cleared required Gateway provider the same way creation does.
- Clearing a person/company primary phone in Customers v2 must persist as empty after save and reload.

Add integration tests that exercise the failing edit flows through the UI/API surface used by the product.

## Non-goals

- Do not change checkout payment state transitions, public pay-page contracts, or gateway provider APIs.
- Do not redesign customer profile/contact data models.
- Do not touch the QA items that already passed in the issue comment.
- Do not apply database migrations locally.

## Implementation Plan

### Phase 1: Root Cause And Fixes

1.1 Identify checkout template create/edit validation asymmetry and enforce required gateway provider consistently.

1.2 Identify why empty customer phone values are lost on people-v2 and companies-v2 saves, then normalize/save the cleared value without regressing email/url clearing.

### Phase 2: Integration Coverage

2.1 Add checkout integration coverage for editing an existing template and clearing the gateway provider.

2.2 Add customers integration coverage for clearing primary phone on both people-v2 and companies-v2 records.

### Phase 3: Validation And PR

3.1 Run targeted validation for checkout, customers, and the new integration tests.

3.2 Run the full auto-create-pr validation gate, self-review against `om-code-review` and `BACKWARD_COMPATIBILITY.md`, open the PR, run the `om-auto-review-pr` autofix pass, and post the required summary comment including tested coverage.

## Risks

- Checkout templates may have intentionally allowed gateway-less drafts; the UI already marks the field required and create validation rejects missing gateway, so this fix aligns edit behavior with the existing visible contract.
- Phone clearing may fail either in form serialization or API normalization. The fix must preserve `undefined` as "unchanged" where applicable while treating submitted empty strings/nulls as an explicit clear.
- Integration tests must not rely on seeded demo records; fixtures should be created and cleaned up inside the tests.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root Cause And Fixes

- [x] 1.1 Identify checkout template create/edit validation asymmetry and enforce required gateway provider consistently — 7612e680e
- [x] 1.2 Identify why empty customer phone values are lost on people-v2 and companies-v2 saves, then normalize/save the cleared value without regressing email/url clearing — 7612e680e

### Phase 2: Integration Coverage

- [x] 2.1 Add checkout integration coverage for editing an existing template and clearing the gateway provider — 7612e680e
- [x] 2.2 Add customers integration coverage for clearing primary phone on both people-v2 and companies-v2 records — 7612e680e

### Phase 3: Validation And PR

- [x] 3.1 Run targeted validation for checkout, customers, and the new integration tests — 7612e680e
- [x] 3.2 Run the full auto-create-pr validation gate, self-review against `om-code-review` and `BACKWARD_COMPATIBILITY.md`, open the PR, run the `om-auto-review-pr` autofix pass, and post the required summary comment including tested coverage — f7d637c4b
