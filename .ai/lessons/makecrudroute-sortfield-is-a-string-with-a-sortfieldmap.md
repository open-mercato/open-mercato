---
title: "makeCrudRoute `sortField` must be `z.string()` + `sortFieldMap`, not a strict enum"
modules: ["eudr","customers"]
areas: ["module-data","backend-ui"]
topics: ["crud-factory","query-index"]
---

# makeCrudRoute `sortField` must be `z.string()` + `sortFieldMap`, not a strict enum

**Context**: eudr list routes validated `sortField` with `z.enum([...])` while their DataTables enabled table-wide `sortable`; every non-enum header click sent the camelCase accessorKey and the factory returned 400, flashing a load error (2026-07-06 review blocker).

**Rule**: List schemas accept `sortField: z.string().optional()` and resolve through `sortFieldMap` (camelCase accessor → column) with the factory's default fallback, mirroring `customers/api/people/route.ts`. Map every accessorKey the page renders as sortable.

**Applies to**: any `makeCrudRoute` list paired with a sortable DataTable.
