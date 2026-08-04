---
title: "Async edit selects must be hydrated as value-plus-options"
modules: ["checkout","entities","ui"]
areas: ["backend-ui","integration","testing"]
topics: ["custom-fields","filters","testing"]
---

# Async edit selects must be hydrated as value-plus-options

**Context**: Several edit forms saved relation/dictionary/select values correctly but reopened with the select trigger showing the placeholder. The saved value arrived before or after the option list depending on the page: staff team roles, resources, dictionary-backed capacity units, checkout gateway settings, and example TODO custom fields exposed variants of the same failure.

**Problem**: A controlled Radix Select can stay visually unresolved when the selected value and its matching `SelectItem` are registered in separate async renders. Page-level loaders also often fetch by `ids=...`; if the API only supports singular `id`, the edit form may hydrate from the wrong first-page record while still appearing to load successfully.

**Rule**: Edit forms must hydrate selects with both the saved scalar value and a matching option label. If the saved option may be outside the first page, fetch it by id and seed/prepend it. Generic select controls should remount or otherwise re-resolve when either the selected value or option set changes. For list APIs used by edit loaders, support the shared `ids` filter contract and cover it with browser integration tests that create their own fixture records.

**Applies to**: `CrudForm` select fields, relation/dictionary selects, edit-page option loaders, `makeCrudRoute` list APIs, and every browser test that verifies edit forms open with saved select values populated.
