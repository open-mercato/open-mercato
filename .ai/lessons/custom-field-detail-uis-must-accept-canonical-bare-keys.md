---
title: "Custom-field detail UIs must accept canonical bare keys"
modules: ["entities","ui","customers"]
areas: ["umes","backend-ui","debugging"]
topics: ["custom-fields","generated-files","ui-components"]
---

# Custom-field detail UIs must accept canonical bare keys

**Context**: Customer detail APIs normalize custom-field responses to bare keys such as `relationship_health`, while generated form fields use prefixed IDs such as `cf_relationship_health`.

**Problem**: Read-only detail renderers that index only by the generated prefixed ID show empty select/relation values after a fresh fetch, even though editing and saving may work because form initialization has fallback key resolution.

**Rule**: Shared custom-field detail components must resolve values by exact field ID first, then `cf:` and bare-key fallbacks for prefixed fields. Apply the same resolver to relation-display loading and read-only rendering so select, relation, text, and boolean fields use one response-shape contract.

**Applies to**: `packages/ui/src/backend/detail/CustomDataSection.tsx`, customer/company/person detail custom-data sections, and any new detail renderer consuming normalized `customFields`.
