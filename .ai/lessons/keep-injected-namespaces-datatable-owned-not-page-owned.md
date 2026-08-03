---
title: "Keep injected namespaces DataTable-owned, not page-owned"
modules: ["ui"]
areas: ["backend-ui","umes","debugging"]
topics: ["filters","testing","ui-components"]
---

# Keep injected namespaces DataTable-owned, not page-owned

**Context**: Injected datatable values (for example `_example.priority`) were visible in API payloads and saved correctly, but list columns still rendered fallback values like `normal`.

**Problem**: Multiple list pages mapped API items into whitelisted row objects and accidentally dropped `_namespace` fields. That made injected columns/filters/actions unreliable and forced page-level coupling to specific modules.

**Rule**: Namespace preservation must be centralized in `DataTable` helpers. Page mappers must remain module-agnostic and finalize mapped rows with `withDataTableNamespaces(mappedRow, sourceItem)` instead of manually handling injection keys.

**Applies to**: Any backend page/component that maps API records before passing rows to `DataTable` (especially pages using `perspective.tableId` and injection-based extensions).
