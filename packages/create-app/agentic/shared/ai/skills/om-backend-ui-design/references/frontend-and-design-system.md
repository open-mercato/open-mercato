# Frontend Routes, App Design, and UX

Load this reference for public frontend, portal, or visually substantial application work. It complements the CRUD-specific reference; it does not authorize edits outside `src/modules/`.

## Route and Shell Contract

- Public pages live at `frontend/**/page.tsx` and map to the corresponding public path. Add sibling `page.meta.ts`; explicitly declare whether staff/customer auth or features are required.
- Portal pages live at `frontend/[orgSlug]/portal/**/page.tsx`; `[orgSlug]` is the first segment. Public login/signup/verify/anonymous landing pages set `navHidden: true` and omit `requireCustomerAuth`; authenticated pages declare it and derive customer/org scope from the principal rather than trusting route or payload IDs alone.
- Portal destinations that belong in the sidebar declare `metadata.nav`; detail/create/edit pages omit it. External/no-page links use the portal menu-injection surface.
- Backend pages live under `backend/**/page.tsx`. Settings/profile destinations use their page context, and secondary CRUD destinations remain navigation-hidden.
- `frontend/middleware.ts` and `backend/middleware.ts` are auto-discovered page guards. Export named `middleware` or a default array whose entries preserve stable `{ id, mode?, target, priority?, run }`. UI visibility is not authorization: protect the server page/API independently.
- Keep server-first data/auth and a narrow client boundary. Make the first server/client render deterministic across locale, timezone, feature state, randomness, and browser APIs.

## Product and Page Design

1. Name the primary actor, goal, route, key decision, and success state before choosing components.
2. Reuse the closest shared family before composing a local variant: page shell, detail sections, filters, DataTable, CrudForm, charts/KPIs, schedules, messages, notifications, forms chrome, banners, and progress.
3. Establish one visual hierarchy: page title/context, primary action, task content, supporting details. Avoid card grids or dashboards when a list/form/detail flow is clearer.
4. Design narrow/mobile and long translated content first; then enhance wide layouts. Avoid fixed widths that break portal/mobile shells.
5. Keep destructive/irreversible actions explicit and separated; confirm when needed. Preserve entered data and focus across validation or server failures.

## Design-System Contract

- Use exported `@open-mercato/ui` primitives/components and semantic CSS/Tailwind tokens. Never hard-code hex/RGB for semantic, status, or general application UI, status palette classes, arbitrary Tailwind values/text sizes, or manual semantic-token `dark:` overrides. The documented brand gradient is limited to approved public hero/marketing, floating CTA, onboarding, or celebration moments.
- Render system state through `StatusBadge`. Use `Tag`/`TagMap` variants for user-applied labels and categories; they need not be neutral, but never hard-code their colors. Use the current `Alert status="information|success|warning|error|feature" style="light|lighter|stroke|filled"` API, flash, and notification families for feedback.
- Use standard form controls and `FormField` for standalone forms; `CrudForm` owns its field layout and its fields must not be wrapped in `FormField`. Use `DataTable` for portal lists. Use shared `Button`/`IconButton`/`Checkbox`/`LinkButton`, dialogs/drawers, tabs, pagination, separators, and Lucide icons instead of raw `<button>`, raw checkbox inputs, button-styled links, or inline SVG.
- Never use `window.confirm`; use `ConfirmDialog`/`useConfirmDialog`.
- Follow tokenized radius, spacing, border, shadow, layering, opacity, and motion. Honor reduced motion and avoid decorative animation that delays work.
- Prefer content-driven sizing and mobile-first standard breakpoints (`sm`, `md`, `lg`, `xl`, `2xl`). Do not use arbitrary media queries, desktop-first `max-*`, or inline style dimensions when a component prop/token exists.

## Portal Extension Contract

- Hooks: `useCustomerAuth`, `useTenantContext`, `usePortalInjectedMenuItems`, `usePortalEventBridge`, and `usePortalAppEvent` from their `@open-mercato/ui/portal/hooks/*` exports.
- Frozen menu spots: `menu:portal:sidebar:main`, `menu:portal:sidebar:account`, `menu:portal:header:actions`, `menu:portal:user-dropdown`.
- Frozen widget spots: `portal:dashboard:sections`, `portal:dashboard:profile`, `portal:dashboard:sidebar`, `portal:<pageId>:before`, and `portal:<pageId>:after`.
- Frozen component handles: `page:portal:layout`, `section:portal:header`, `section:portal:footer`, `section:portal:sidebar`, and `section:portal:user-menu`.
- A page metadata `nav` block is enough for an internal portal destination and is filtered with the same customer feature requirements. Use menu injection only for external/no-page entries. Preserve wildcard ACL behavior and protect APIs independently.

## UX State Matrix

Every applicable page or operation covers:

- loading/skeleton without layout jumps;
- healthy empty/not-found states with a safe recovery action;
- field validation and first-invalid focus;
- server/network failure with preserved input and safe retry;
- authorization denial distinct from not-found;
- optimistic-lock conflict with reload/reapply guidance;
- duplicate-submit prevention and visible in-progress state;
- success confirmation plus authoritative reload/render;
- keyboard navigation, visible focus, labelled icon controls, semantic headings, contrast, and screen-reader announcement of async results.

Dialogs support Cmd/Ctrl+Enter submit and Escape cancel unless Escape would lose an irreversible in-progress operation. Test narrow and wide layouts, keyboard-only use, at least one alternate locale for dense copy, allowed/denied/wildcard roles, and the real API round trip with self-contained fixtures.
