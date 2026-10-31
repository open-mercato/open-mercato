---
title: "Bounded trackers need per-admission identity"
modules: ["shared", "audit_logs"]
areas: ["architecture", "testing"]
topics: ["concurrency", "observability", "testing"]
---

# Bounded trackers need per-admission identity

**Context**: Review of PR #5802 found that two accepted factories returning the same promise overwrote one map entry while incrementing a separate pending counter twice. Settlement leaked a slot and `flush()` could spin on an empty map.

**Rule**: Give every admission its own token and reserve its tracked promise before invoking user code. Derive pending depth from the registry size. Test repeated promise identities on both resolution and rejection, plus synchronous reentrant admission and flush.

**Operational evidence**: A rate-limited overload warning must carry accumulated and cumulative drop counts even when telemetry is disabled. Test the actual warning payloads at each owning call site, and document whether counts represent tasks or individual records.
