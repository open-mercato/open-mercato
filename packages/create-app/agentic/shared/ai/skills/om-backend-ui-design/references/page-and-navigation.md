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
