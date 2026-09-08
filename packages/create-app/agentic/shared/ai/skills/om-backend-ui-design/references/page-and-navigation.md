# Page and Navigation Branch

Load this reference when adding/moving/hiding a page or navigation item.

1. Choose backend/settings/profile/frontend/portal from `.ai/guides/backend-ui.md`.
2. Add `page.tsx` and sibling `page.meta.ts` with auth/features and the generated backend metadata keys: localized `pageTitleKey`, `pageGroupKey`, numeric `pagePriority`/`pageOrder`, stable string `icon`, and localized `breadcrumb`. Do not substitute an unrecognized nested `nav` object.
   Server pages import `resolveTranslations` from `@open-mercato/shared/lib/i18n/server` and destructure its result: `const { t } = await resolveTranslations()` (or `{ translate }` when fallback arguments are needed); the returned object is not itself callable.
3. Hide create/edit/detail pages from navigation. For settings pair `pageContext: 'settings' as const` with `navHidden: true`.
4. Portal pages keep `[orgSlug]` first, use customer auth/features, and add `nav` only for portal sidebar destinations.
5. Use menu widgets for adding/reordering another module's navigation and module route overrides for hiding/replacing an installed page.
6. Run `yarn generate`; verify allowed/denied/wildcard navigation and direct-route access.

Use Lucide components inside page UI. Avoid inline SVG and prefer serializable icon strings in metadata.

`icon` strings resolve against a closed registry that is generated when `@open-mercato/ui` is built, from framework sources only — an app's own metadata never adds to it, and `resolveRegisteredLucideIcon` returns `null` for anything else, so the nav entry renders with no icon and no error. Before choosing a name, confirm it in the installed registry (`node_modules/@open-mercato/ui/dist/backend/icons/lucideRegistry.generated.js`) or reuse one the example module already uses; when nothing fits, register the component through `registerAdditionalIcons` from `@open-mercato/ui/backend/icons/lucideRegistry` during server bootstrap instead of inventing a name, and confirm the icon renders before relying on it.

Canonical example source — server-rendered `Page`/`PageHeader`/`PageBody` with a sibling `page.meta.ts` carrying guards, nav group/order, icon token and breadcrumb `labelKey`: [`backend/todos/page.tsx`](../../../../src/modules/example/backend/todos/page.tsx), [`backend/todos/page.meta.ts`](../../../../src/modules/example/backend/todos/page.meta.ts), [`backend/page.tsx`](../../../../src/modules/example/backend/page.tsx), [`backend/page.meta.ts`](../../../../src/modules/example/backend/page.meta.ts). A module-owned route outside `/backend`: [`frontend/example.tsx`](../../../../src/modules/example/frontend/example.tsx). The example ships no portal page or page middleware — follow steps 3–4 and the portal facts instead.
