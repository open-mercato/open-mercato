---
title: "Stabilization CI must not follow label churn"
modules: ["platform"]
areas: ["ai-workflow","testing"]
topics: ["ci-scheduling","stabilization","required-checks","regression-testing"]
---

# Stabilization CI must not follow label churn

The `ci-full` change in PR #8623 added `labeled` to the main CI trigger but gated only `prepare`. PR #8752 subsequently scheduled 18 CI runs for one commit: one opening event and 17 label additions. Independent lint jobs still ran, and unique label concurrency groups prevented coalescing. The original regression test checked only the prepare condition and therefore missed the scheduling failure.

Full stabilization validation belongs to same-repository `stabilize/*` PRs on code/PR lifecycle events. Ordinary labels must neither schedule CI nor alter its scope. Preserve required check identities and reject designs that create skipped versions of existing required checks, because skipped jobs report success. Test event eligibility and every independent root job, then execute the actual workflow scope/typecheck/unit scripts for ordinary PRs, stabilization PRs, fork prefixes, and protected-branch pushes. Full validation includes typechecking and unit tests as well as integration shards.
