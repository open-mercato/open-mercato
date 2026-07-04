---
name: om-backend-ui-design
description: Design and implement consistent backend/backoffice interfaces using @open-mercato/ui. Use when building admin pages, CRUD interfaces, data tables, forms, detail pages, or any backoffice UI.
---

# Backend UI Design

Build consistent, production-grade backend/backoffice interfaces with the `@open-mercato/ui` component library. Reuse existing components for visual and behavioral consistency instead of hand-rolling custom UI.

## When to use

- Building or reviewing admin pages, CRUD interfaces, data tables, forms, detail pages, or any backoffice UI.
- Wiring list pagination, dialogs, loading/error/empty states, flash notifications, or custom-field UI.
- Not for design-system token compliance audits (`om-ds-guardian`) or scaffolding a whole module (`om-module-scaffold`).

## What it contains

`instructions.md` holds the full playbook: design principles, the required-component library with import snippets (layout, `DataTable` + host pattern + pagination, `CrudForm`, form headers/footers, dialogs, detail sections, notifications, loading/error states, primitives), API + custom-field integration, the implementation checklist, anti-patterns, visual guidelines, and page-navigation metadata. `references/ui-components.md` is the complete component API catalog.

## Reference map — load what the task needs

| When | Load |
|------|------|
| Building any backend UI — principles, component patterns, checklist, anti-patterns | [`instructions.md`](instructions.md) |
| Looking up the full component API surface and import paths | [`references/ui-components.md`](references/ui-components.md) |
| Canonical design-system, UI, and code-quality rules (single source of truth) | [`AGENTS.md`](../../../AGENTS.md) |

## Non-negotiables

- Use shared components: `CrudForm` for forms, `DataTable` for tables, `flash()` for notifications, `apiCall`/`apiCallOrThrow` for HTTP — never custom equivalents or raw `fetch`.
- No hardcoded status colors, hex/rgb, or arbitrary text sizes — use semantic status tokens and shared primitives.
- Every dialog wires `Cmd/Ctrl+Enter` (submit) and `Escape` (cancel); dialog forms set `embedded={true}`; every async op shows loading and error feedback.
