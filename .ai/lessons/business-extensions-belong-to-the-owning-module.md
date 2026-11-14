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

Database execution extensions follow the same ownership rule: modules declare their own identity providers, binding checks and retained storage tables through neutral discovery contracts. Shared or enterprise runtime code must not maintain lists of business modules or import their services. Integration probes that query a business table belong to that table's module and use the neutral execution-context API. Inventory must include explicitly declared non-ORM storage because old migrations can retain tables absent from current entity metadata. Evidence: PR #9424 module-boundary correction and live catalog rejection of retained option storage.
