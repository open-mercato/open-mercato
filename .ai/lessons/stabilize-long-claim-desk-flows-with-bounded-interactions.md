---
title: "Stabilize long claim desk flows with bounded interactions and teardown"
modules: ["warranty_claims","ui"]
areas: ["integration","testing","backend-ui"]
topics: ["testing","workers","component-overrides","concurrency","accessibility"]
---

# Stabilize long claim desk flows with bounded interactions and teardown

`TC-WC-040` covers the last line of 101- and 200-line claims. Its failures came from an Actions menu that opens on hover and toggles on click, a vendor-name field without an associated accessible label, and fixture deletion costs that outgrew a shared hook budget.

Check `aria-expanded` before keyboard activation and verify the requested menu item or grading dialog is visible within a short bounded wait. After navigation or reload, wait for the last-line row before invoking its actions. For an existing field whose label is not associated, inspect the rendered component and use its stable `data-crud-field-id` wrapper plus textbox role; track the missing accessible label separately.

Read every fixture page before deleting. Delete distinct lines in bounded batches with each line's own version, then serialize the final delete so aggregate rollups settle before lifecycle cleanup. Preserve response, identity, optimistic-lock and cleanup assertions. Once the real races are fixed, give the large flow and its teardown separate bounded budgets consistent with existing RMA tests; investigate fixture cost before raising them again.

The broader evidence and original lesson remain in [Stabilize flaky integration tests by finding the hang, not by raising the timeout](stabilize-flaky-integration-tests-by-finding-the-hang.md). This focused record preserves the claim flow's concurrency and accessibility routing without exceeding that record's six-topic budget.

Evidence: PR #7974, `TC-WC-040-desk-line-pagination.spec.ts`, and the approving re-review of `8dd273d7d8`.
