---
title: "Bounded trackers need per-admission identity"
modules: ["shared", "audit_logs"]
areas: ["architecture", "testing"]
topics: ["concurrency", "observability", "testing", "security", "tenant-isolation"]
---

# Bounded trackers need per-admission identity

**Context**: Review of PR #5802 found that two accepted factories returning the same promise overwrote one map entry while incrementing a separate pending counter twice. Settlement leaked a slot and `flush()` could spin on an empty map.

**Rule**: Give every admission its own token and reserve its tracked promise before invoking user code. Derive pending depth from the registry size. Test repeated promise identities on both resolution and rejection, plus synchronous reentrant admission and flush.

**Operational evidence**: A rate-limited overload warning must carry accumulated and cumulative drop counts even when telemetry is disabled. Test the actual warning payloads at each owning call site, and document whether counts represent tasks or individual records.

**Tenant admission**: A process-wide hard cap alone lets one tenant suppress another tenant's best-effort audit trail. At both dispatch and persistence boundaries, reserve capacity by trusted tenant scope; share its quota across organizations, normalize identity aliases, and charge every tenant in a mixed batch. Keep the global hard cap, delete scope counters on settlement, and never use tenant IDs as telemetry labels. Test tenant A saturation while B still writes, global saturation, mixed batches, recovery, and invalid minimum-capacity configuration. Existing retention work must not occupy every writer's slot; include it separately in shutdown draining.
