# Page and Navigation Branch

Load this reference when adding/moving/hiding a page or navigation item.

1. Choose backend/settings/profile/frontend/portal from `.ai/guides/backend-ui.md`.
2. Add `page.tsx` and sibling `page.meta.ts` with auth/features, translated title, group/key/order, stable string icon name, and breadcrumb where applicable.
3. Hide create/edit/detail pages from navigation. For settings pair `pageContext: 'settings' as const` with `navHidden: true`.
4. Portal pages keep `[orgSlug]` first, use customer auth/features, and add `nav` only for portal sidebar destinations.
5. Use menu widgets for adding/reordering another module's navigation and module route overrides for hiding/replacing an installed page.
6. Run `yarn generate`; verify allowed/denied/wildcard navigation and direct-route access.

Use Lucide components inside page UI. Avoid inline SVG and prefer serializable icon strings in metadata.
