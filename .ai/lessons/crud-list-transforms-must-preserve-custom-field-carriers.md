---
title: "CRUD list transforms must preserve custom-field carriers until decoration"
modules: ["wms","entities"]
areas: ["module-data","backend-ui","testing"]
topics: ["custom-fields","data-integrity","route-coverage"]
---

# CRUD list transforms must preserve custom-field carriers until decoration

**Context**: The WMS Site list route used a response transformer to normalize entity fields before the shared CRUD custom-field decorator ran.

**Problem**: Rebuilding each item from a fixed allowlist dropped raw `cf_*` and `cf:` carriers. Custom-field values were stored correctly but disappeared from list responses before they could be normalized into canonical `customValues` and `customFields`.

**Rule**: A CRUD list transformer that runs before custom-field decoration must either spread the raw item and override normalized fields, or explicitly retain every supported custom-field carrier. Verify the full create-to-list round trip through the real route pipeline.

**Applies to**: `makeCrudRoute` list transforms, response enrichers, and any module that combines custom fields with an explicit API response shape.
