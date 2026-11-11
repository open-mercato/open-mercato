---
title: "Verify integration fixture cleanup against the actual endpoint"
modules: ["resources","entities","customers","sales","warranty_claims","channel_discord"]
areas: ["testing","integration"]
topics: ["testing","fixture-cleanup","fixture-setup","api-contracts","schema-validation","proposal-origin"]
---

# Verify integration fixture cleanup against the actual endpoint

While implementing resources undo coverage for #2577, copying the customer custom-field test's cleanup shape would have left definitions active: `DELETE /api/entities/definitions` reads `entityId` and `key` from its JSON body, not URL query parameters.

Read both setup and teardown handlers before reusing a fixture pattern. Send the endpoint's actual payload and assert successful cleanup for custom configuration. Likewise, derived read fields such as resource-type `resourceCount` need their explicit query option; a successful list response alone does not prove the requested projection was returned.

Validate nested setup payloads against the endpoint's schema as well. Sales order creation requires `lines[].currencyCode` even when the header supplies `currencyCode`; omitting it made `TC-WC-038` fail during setup before reaching the claim-order regression. Reuse the sales fixture helpers where possible, and check required child fields when a test needs a custom header payload.

The #7850 authorization regression hit the same distinction: canonical interaction DELETE accepts a query ID, while the legacy `DELETE /api/customers/activities` adapter requires `{ id }` in its JSON body. A query-only request returned 400 before the privacy guard, so it did not test the intended 404 denial. Verify each adapter's request contract independently when asserting authorization, even when both routes delegate to the same command.

Evidence: `packages/core/src/modules/entities/api/definitions.ts` DELETE; `packages/core/src/modules/resources/api/resourceTypeCounts.ts`; `TC-UNDO-001-resources.spec.ts` and `TC-UNDO-001-resource-types.spec.ts`; `packages/core/src/modules/sales/data/validators.ts` (`lineSharedSchema`, `orderCreateSchema`); `TC-WC-038-order-reference-integrity.spec.ts`; `customers/api/activities/route.ts` DELETE; `TC-CRM-EMAIL-VISIBILITY-005.spec.ts`.

After merging authorization changes, also verify that setup reaches the intended guard. Discord refusal fixtures must be created as admin and authenticated with `stampSystemProposalFixture`; ordinary client cards fail the origin check before source-read validation. Keep forged-card coverage separate, use a unique scenario ID, and scope cleanup to records owned by the test. Evidence: PR #7356 review and `TC-CHANNEL-DISCORD-013`/`TC-CHANNEL-DISCORD-014`.
