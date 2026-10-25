---
title: "Verify integration fixture cleanup against the actual endpoint"
modules: ["resources", "entities"]
areas: ["testing", "integration"]
topics: ["testing", "fixture-cleanup", "api-contracts"]
---

# Verify integration fixture cleanup against the actual endpoint

While implementing resources undo coverage for #2577, copying the customer custom-field test's cleanup shape would have left definitions active: `DELETE /api/entities/definitions` reads `entityId` and `key` from its JSON body, not URL query parameters.

Read both setup and teardown handlers before reusing a fixture pattern. Send the endpoint's actual payload and assert successful cleanup for custom configuration. Likewise, derived read fields such as resource-type `resourceCount` need their explicit query option; a successful list response alone does not prove the requested projection was returned.

Evidence: `packages/core/src/modules/entities/api/definitions.ts` DELETE; `packages/core/src/modules/resources/api/resourceTypeCounts.ts`; `TC-UNDO-001-resources.spec.ts` and `TC-UNDO-001-resource-types.spec.ts`.
