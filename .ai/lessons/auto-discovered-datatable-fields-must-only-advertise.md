---
title: "Auto-discovered DataTable fields must only advertise controls the table can actually honor"
modules: ["ui","customers","entities"]
areas: ["backend-ui","umes","module-data"]
topics: ["custom-fields","filters","ui-components"]
---

# Auto-discovered DataTable fields must only advertise controls the table can actually honor

**Context**: The customer grids auto-discovered custom fields into the advanced-filter builder and column chooser, but the table pages only registered `listVisible` custom columns. Hidden-but-selectable fields like `cf_executive_notes` appeared in the chooser without a matching TanStack column id.

**Problem**: The chooser could surface legitimate field labels that crashed at toggle time with `Column with id 'cf_executive_notes' does not exist`, because discovery and actual column registration drifted apart.

**Rule**: When a DataTable auto-discovers fields from entity/custom-field metadata, keep the discovery surface aligned with the concrete column registry. If a field should be selectable later, register a real hidden column for it; otherwise keep it out of chooser/filter discovery entirely.

**Applies to**: `DataTable` auto-discovery, custom-field-backed list pages, and any future metadata-driven chooser/filter UI.
