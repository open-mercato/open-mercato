export const metadata = {
  requireAuth: true,
  requireFeatures: ['planner.manage_availability'],
  pageTitle: 'Create schedule',
  pageTitleKey: 'planner.availabilityRuleSets.form.createTitle',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  navHidden: true,
  breadcrumb: [
    { label: 'Availability schedules', labelKey: 'planner.availabilityRuleSets.page.title', href: '/backend/planner/availability-rulesets' },
    { label: 'Create schedule', labelKey: 'planner.availabilityRuleSets.form.createTitle' },
  ],
}
