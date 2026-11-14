---
title: "Business extensions belong to the owning module"
modules: ["customers", "example", "shared", "ui"]
areas: ["architecture", "backend-ui", "testing"]
topics: ["module-boundaries", "testing", "template-sync", "public-contracts"]
---

# Business extensions belong to the owning module

**Context**: Calendar extensions introduced business-specific props and metadata into shared forms, widget loading, and override dispatch. Independent review also found regressions when picker configuration became a blanket restriction on existing command callers.

**Rule**: Compose business behavior in its owning module through existing generic fields, widget payloads, and optional DI services. Keep shared contracts module neutral. Preserve existing callers when adding selection or applicability rules: picker visibility is separate from internal command availability, and empty configuration must retain legacy custom-field behavior. Optional integrations must distinguish absent modules from failed installed services; warn and skip absent capabilities while keeping installed-service authorization and data checks.

**Applies to**: Customers calendar extension contracts, optional example integrations, shared UI components, and their standalone templates and harness guides.

Shared form value projection must use declared injected fields to identify owned namespaces, rather than treating every underscore-prefixed host value as contributed data. Tests for contributor retry/version baselines must declare the owning field namespace and retain assertions that native submissions exclude it. Public event hooks must preserve full rendered-widget return types while accepting typed headless participants. Evidence: PR #6931 independent review and `CrudForm.resourceIdentity`, `CrudForm.injectionLifecycle`, and `InjectionSpot.features` regressions.
