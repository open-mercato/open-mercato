# Frontend Routes, App Design, and UX

Load this reference for public frontend, portal, or visually substantial application work. It complements the CRUD-specific reference; it does not authorize edits outside `src/modules/`.

## Route and Shell Contract

- Public pages live at `frontend/**/page.tsx` and map to the corresponding public path. Add sibling `page.meta.ts`; explicitly declare whether staff/customer auth or features are required.
- Portal pages live at `frontend/[orgSlug]/portal/**/page.tsx`; `[orgSlug]` is the first segment. Use portal auth/context hooks, derive customer/org scope from the authenticated principal, and never trust route or payload IDs alone.
- Portal destinations that belong in the sidebar declare `metadata.nav`; detail/create/edit pages omit it. External/no-page links use the portal menu-injection surface.
- Backend pages live under `backend/**/page.tsx`. Settings/profile destinations use their page context, and secondary CRUD destinations remain navigation-hidden.
- `frontend/middleware.ts` and `backend/middleware.ts` are auto-discovered page guards. UI visibility is not authorization: protect the server page/API independently.
- Keep server-first data/auth and a narrow client boundary. Make the first server/client render deterministic across locale, timezone, feature state, randomness, and browser APIs.

## Product and Page Design

1. Name the primary actor, goal, route, key decision, and success state before choosing components.
2. Reuse the closest shared family before composing a local variant: page shell, detail sections, filters, DataTable, CrudForm, charts/KPIs, schedules, messages, notifications, forms chrome, banners, and progress.
3. Establish one visual hierarchy: page title/context, primary action, task content, supporting details. Avoid card grids or dashboards when a list/form/detail flow is clearer.
4. Design narrow/mobile and long translated content first; then enhance wide layouts. Avoid fixed widths that break portal/mobile shells.
5. Keep destructive/irreversible actions explicit and separated; confirm when needed. Preserve entered data and focus across validation or server failures.

## Design-System Contract

- Use exported `@open-mercato/ui` primitives/components and semantic CSS/Tailwind tokens. Never hard-code hex/RGB, status palette classes, arbitrary Tailwind values/text sizes, or manual semantic-token `dark:` overrides.
- Use status semantics only for actual status/feedback and render status through `StatusBadge`; use neutral `Tag` for categories. Use `Alert`/flash/notification families for feedback.
- Use the standard form controls and `FormField`; do not recreate label/help/error wiring. Use standard buttons, icon buttons, dialogs/drawers, tabs, pagination, separators, and Lucide icons instead of raw equivalents or inline SVG.
- Follow tokenized radius, spacing, border, shadow, layering, opacity, and motion. Honor reduced motion and avoid decorative animation that delays work.
- Prefer content-driven sizing and shared responsive breakpoints. Do not use inline style dimensions when a component prop/token exists.

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
