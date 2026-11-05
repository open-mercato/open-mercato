export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.backend'],
  pageTitle: 'Component overrides',
  pageTitleKey: 'example.componentOverrides.page.title',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20700,
  icon: 'layers',
  // Reference surface, not a product screen: routed and reachable by URL, absent from
  // the sidebar so it cannot be mistaken for a feature.
  navHidden: true,
  breadcrumb: [
    { label: 'Component overrides', labelKey: 'example.componentOverrides.page.title' },
  ],
}

export default metadata
