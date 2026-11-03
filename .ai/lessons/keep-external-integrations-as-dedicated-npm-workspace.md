---
title: "Keep external integrations as dedicated npm workspace packages"
modules: ["data_sync","integrations"]
areas: ["integration","umes"]
topics: ["module-boundaries","package-runtime","provider-lifecycle"]
---

# Keep external integrations as dedicated npm workspace packages

**Context**: Provider modules like shipping carriers and payment gateways were implemented in `packages/core/src/modules/*`, which blurs the boundary between core platform modules and optional external connectors.

**Problem**: This makes provider ownership unclear, slows independent releases, and violates the integration marketplace package model (SPEC-045/SPEC-045c) where connectors are separate installable modules.

**Rule**: Any external integration provider (payment/shipping/communication/data-sync connector) must be implemented as its own package under `packages/<provider-package>/` and enabled from `apps/mercato/src/modules.ts` via that package. Do not add new external provider modules in `packages/core/src/modules/`.

**Applies to**: All new connector work and refactors of existing providers (for example, `gateway_*`, `carrier_*`, and sync connector modules), with UMES extension points per SPEC-041.
