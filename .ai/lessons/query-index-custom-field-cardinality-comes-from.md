---
title: "Query-index custom-field cardinality comes from definitions, not row count"
modules: ["entities","query_index","search","shared","customers"]
areas: ["module-data","umes","backend-ui"]
topics: ["custom-fields","data-scoping","query-index","encryption","filters"]
---

# Query-index custom-field cardinality comes from definitions, not row count

**Context**: A `multi: true` todo label containing one value was searchable, but reopening the edit form showed no tag. The query-index builder collapsed every one-row custom-field group to a scalar, while the controlled tags input correctly accepted only an array.

**Problem**: Inferring cardinality from the current number of stored rows makes the same field change wire shape between one and two values. Read forms then cannot reliably hydrate multi controls, even though token search still sees the scalar value.

**Rule**: When building query-index documents, resolve the scoped custom-field definition and preserve arrays for `multi: true` fields even when exactly one value is stored. Use the shared definition-selection helpers so tenant/organization overrides match CRUD response decoration.

**Applies to**: `packages/core/src/modules/query_index/lib/indexer.ts`, custom-field projection builders, CRUD list responses backed by `entity_indexes.doc`, and edit forms for tags/listbox/multi-select fields.

**Filtering correction (#7996)**: Do not bind a custom-field predicate to the base record merely because it entered through the base list API. CRM routes supply secondary sources. Resolve the field through existing definition/source precedence, then bind encrypted token checks to that source's entity, record and organization. Use the same source selection for data and count, retain generated aliases, and test duplicate keys plus wrong-tenant/organization token evidence. Token presence is field-scoped evidence, not proof for each stored array element.
