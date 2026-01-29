export const metadata = {
  requireAuth: true,
  requireFeatures: ['business_rules.manage_sets'],
  pageTitle: 'Create Rule Set',
  pageGroup: 'Business Rules',
  pageGroupKey: 'rules.nav.group',
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Rule Sets', labelKey: 'rules.nav.sets' }, { label: 'Create Rule Set' }],
}
