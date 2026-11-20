---
title: "Check pending compatibility disclosures as a union"
modules: ["create_app","attachments","search","notifications"]
areas: ["framework-context","spec-pr","testing"]
topics: ["backward-compatibility","instruction-budget","testing"]
---

# Check pending compatibility disclosures as a union

**Context**: Concurrent security fixes add mandatory dated entries to the same backward-compatibility snapshot read by standalone harness cases.

**Problem**: Each compact entry fit independently under the existing caps, but the four pending entries together exceeded the tightest case by 292 bytes. Independent PR checks did not prove that the disclosures could coexist.

**Rule**: Measure the exact union of pending disclosures against the unchanged canonical cases and regression. Use the other entries only in a temporary fixture. Preserve the full client/operator migration disclosure in the spec and upgrade notes, the qualifying argument and classification in each dated entry, and the named human waiver gate. Prefer reviewable input compaction to unnecessary cap increases. Verify formatting separately with complete Markdown AST equality and raw protected-policy identity; condensed audit text requires its own content review.

**Applies to**: `BACKWARD_COMPATIBILITY.md`, standalone compatibility-context budgets, and concurrent security-disclosure PRs. Passing the budget regression does not grant a security waiver or certify a changed harness contract.

**2026-11-18 evidence**: The #9135 disclosure overflowed OMH-022 by 1,015 bytes. Compact each dated ledger entry and the existing hierarchy-correction audit prose while preserving the emergency-exception policy byte for byte. Run `compatibility-context-budget.test.ts` for each branch and a temporary union of both new entries; all seven checks must pass without changing caps or required/forbidden context. Keep full migration detail in the issue specs and upgrade notes.
