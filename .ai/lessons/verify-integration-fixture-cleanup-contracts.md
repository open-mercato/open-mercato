---
title: "Verify integration fixture cleanup against the actual endpoint"
modules: ["resources","entities","customers","sales","warranty_claims","channel_discord","catalog","workflows"]
areas: ["testing","integration"]
topics: ["testing","fixture-cleanup","fixture-setup","api-contracts","proposal-origin","error-handling"]
---

# Verify integration fixture cleanup against the actual endpoint

While implementing resources undo coverage for #2577, copying the customer custom-field test's cleanup shape would have left definitions active: `DELETE /api/entities/definitions` reads `entityId` and `key` from its JSON body, not URL query parameters.

Read both setup and teardown handlers before reusing a fixture pattern. Send the endpoint's actual payload and assert successful cleanup for custom configuration. Likewise, derived read fields such as resource-type `resourceCount` need their explicit query option; a successful list response alone does not prove the requested projection was returned.

Validate nested setup payloads against the endpoint's schema as well. Sales order creation requires `lines[].currencyCode` even when the header supplies `currencyCode`; omitting it made `TC-WC-038` fail during setup before reaching the claim-order regression. Reuse the sales fixture helpers where possible, and check required child fields when a test needs a custom header payload.

The #7850 authorization regression hit the same distinction: canonical interaction DELETE accepts a query ID, while the legacy `DELETE /api/customers/activities` adapter requires `{ id }` in its JSON body. A query-only request returned 400 before the privacy guard, so it did not test the intended 404 denial. Verify each adapter's request contract independently when asserting authorization, even when both routes delegate to the same command.

Evidence: `packages/core/src/modules/entities/api/definitions.ts` DELETE; `packages/core/src/modules/resources/api/resourceTypeCounts.ts`; `TC-UNDO-001-resources.spec.ts` and `TC-UNDO-001-resource-types.spec.ts`; `packages/core/src/modules/sales/data/validators.ts` (`lineSharedSchema`, `orderCreateSchema`); `TC-WC-038-order-reference-integrity.spec.ts`; `customers/api/activities/route.ts` DELETE; `TC-CRM-EMAIL-VISIBILITY-005.spec.ts`.

After merging authorization changes, also verify that setup reaches the intended guard. Discord refusal fixtures must be created as admin and authenticated with `stampSystemProposalFixture`; ordinary client cards fail the origin check before source-read validation. Keep forged-card coverage separate, use a unique scenario ID, and scope cleanup to records owned by the test. Evidence: PR #7356 review and `TC-CHANNEL-DISCORD-013`/`TC-CHANNEL-DISCORD-014`.

Catalog dictionary authorization coverage in PR #9218 initially stopped at user creation: a UUID password lacks the uppercase character required by the default password policy. Generate fixture passwords satisfying every current policy requirement so denied-read assertions reach the authorization boundary. Evidence: `TC-CAT-046-dictionary-access-scope.spec.ts`, `auth/api/users/route.ts` and `shared/lib/auth/passwordPolicy.ts`.

Review of #9156 found that the generic sales cleanup helper sends only an ID, while `DELETE /api/sales/shipments` also requires `orderId`. Send both fields and assert successful deletion, including for unexpectedly accepted creates in refusal tests. Put the remaining fixture cleanup in a nested `finally` so a failed cleanup assertion still reaches order cascade and reference teardown. Evidence: `sales/api/shipments/route.ts` delete `mapInput` and `TC-SALES-9156-reference-scope.spec.ts`.

Review of #9657 found that an order's updated status does not prove its approval workflow is ready for cancellation: the stock async event activity can leave the instance in `WAITING_FOR_ACTIVITIES`, while the cancel endpoint accepts only `RUNNING` or `PAUSED`. Drain the integration queues with the shared bounded helpers, refresh owned instances before cancellation, and retry transient non-cancellable states within the shared polling budget. Cancel workflows before deleting their target records, and attempt versioned definition deletion in `finally` even when cancellation fails. Evidence: `TC-WC-040-replacement-order-undo.spec.ts`, `sales/workflows.ts`, and `workflows/api/instances/[id]/cancel/route.ts`.

The subsequent hosted trace showed that empty queues still did not prove the fixture's notification transition had advanced. For undo coverage that asserts the status command and its audit history, configure notification dispatch inline in the isolated copied definition; retain the real domain event trigger, scoped grant, status mutation and undo assertions. Do not make fixture teardown depend on unrelated asynchronous notification scheduling. Queue-specific workflow tests retain their async execution configuration. Evidence: PR #9657 run 43825646616 shard 13, retry trace for `TC-WC-040`.
