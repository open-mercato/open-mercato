---
title: "Check pending compatibility disclosures as a union"
modules: ["create_app","attachments","warranty_claims"]
areas: ["framework-context","spec-pr","testing"]
topics: ["backward-compatibility","instruction-budget","context-budget","testing"]
---

# Check pending compatibility disclosures as a union

**Context**: Concurrent security fixes add mandatory dated entries to the same backward-compatibility snapshot read by standalone harness cases.

**Problem**: Each compact entry fit independently under the existing caps, but the four pending entries together exceeded the tightest case by 292 bytes. Independent PR checks did not prove that the disclosures could coexist.

**Rule**: Measure the exact union of pending disclosures against the unchanged canonical cases and regression. Use the other entries only in a temporary fixture. Preserve the full client/operator migration disclosure in the spec and upgrade notes, the qualifying argument and classification in each dated entry, and the named human waiver gate. Prefer reviewable input compaction to unnecessary cap increases. Verify formatting separately with complete Markdown AST equality and raw protected-policy identity; condensed audit text requires its own content review.

**Applies to**: `BACKWARD_COMPATIBILITY.md`, standalone compatibility-context budgets, and concurrent security-disclosure PRs. Passing the budget regression does not grant a security waiver or certify a changed harness contract.

**Evidence (#9110)**: A 1,396-byte compatibility summary raised OMH-022 to 111,676 required bytes against its unchanged 110,592-byte cap, although the module and integration regressions passed. Compact the dated summary while retaining its classification, exploit-preserving bridge argument, migration command and pending named-human waiver; keep full client/operator instructions and rationale in the upgrade notes and module spec. Run `compatibility-context-budget.test.ts` after every root compatibility disclosure, even when no create-app code changes.
