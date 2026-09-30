---
title: "Business extensions belong to the owning module"
modules: ["customers", "example", "shared", "ui"]
areas: ["architecture", "backend-ui", "testing"]
topics: ["module-boundaries", "testing", "template-sync"]
---

# Business extensions belong to the owning module

**Context**: Calendar extensions introduced business-specific props and metadata into shared forms, widget loading, and override dispatch. Independent review also found regressions when picker configuration became a blanket restriction on existing command callers.

**Rule**: Compose business behavior in its owning module through existing generic fields, widget payloads, and optional DI services. Keep shared contracts module neutral. Preserve existing callers when adding selection or applicability rules: picker visibility is separate from internal command availability, and empty configuration must retain legacy custom-field behavior. Optional integrations must distinguish absent modules from failed installed services; warn and skip absent capabilities while keeping installed-service authorization and data checks.

**Applies to**: Customers calendar extension contracts, optional example integrations, shared UI components, and their standalone templates and harness guides.
