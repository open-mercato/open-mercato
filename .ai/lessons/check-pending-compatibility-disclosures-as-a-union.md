---
title: "Check pending compatibility disclosures as a union"
modules: ["create_app","attachments","staff"]
areas: ["framework-context","spec-pr","testing"]
topics: ["backward-compatibility","instruction-budget","testing"]
---

# Check pending compatibility disclosures as a union

**Context**: Concurrent security fixes add mandatory dated entries to the same backward-compatibility snapshot read by standalone harness cases.

**Problem**: Each compact entry fit independently under the existing caps, but the four pending entries together exceeded the tightest case by 292 bytes. Independent PR checks did not prove that the disclosures could coexist.

**Rule**: Measure the exact union of pending disclosures against the unchanged canonical cases and regression. Use the other entries only in a temporary fixture. Preserve the full client/operator migration disclosure in the spec and upgrade notes, the qualifying argument and classification in each dated entry, and the named human waiver gate. Prefer reviewable input compaction to unnecessary cap increases. Verify formatting separately with complete Markdown AST equality and raw protected-policy identity; condensed audit text requires its own content review.

**Applies to**: `BACKWARD_COMPATIBILITY.md`, standalone compatibility-context budgets, and concurrent security-disclosure PRs. Passing the budget regression does not grant a security waiver or certify a changed harness contract.

**Evidence (2026-11-12, #9362):** A late financial-history exception made OMH-022 exceed its cap by 2,604 bytes after an earlier local gate had passed. Rerun context-budget checks after the final compatibility disclosure, not just after runtime changes. Keeping a summary in the contract index while relocating the full historical passkey record restored the original caps; reverse-normalization proved the relocated record retained every original byte apart from heading/link relocation. Named human approval and client/operator migration disclosure remained explicit.
