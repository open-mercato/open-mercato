---
title: "Generator manifests must fall back to source parsing when runtime-importing TS modules is fragile"
modules: ["cli","query_index","queue"]
areas: ["architecture","integration","module-data"]
topics: ["events","generated-files","query-index"]
---

# Generator manifests must fall back to source parsing when runtime-importing TS modules is fragile

**Context**: Module registry generation tried to discover subscriber, worker, and API-route metadata by runtime-importing source files. In optimized dev/build flows, those imports can fail because sibling TS-only dependencies are not executable in that context yet.

**Problem**: When metadata import failed, generated manifests silently lost event bindings or route `metadata.path` overrides. That broke query-index subscribers, produced wrong API paths like `/shipping_carriers/...`, and surfaced as dev-time `MODULE_NOT_FOUND` errors from generated registries.

**Rule**: For generator-time metadata discovery, use runtime imports when they work, but always keep a source-level fallback for stable static exports such as `metadata`. Generation must stay deterministic even when the source module itself is not directly executable.

**Applies to**: `packages/cli` generators that inspect module files, especially subscribers, workers, API routes, and other static manifest inputs.
