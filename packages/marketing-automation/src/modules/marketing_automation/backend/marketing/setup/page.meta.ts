export const metadata = {
  icon: 'check-circle',
  requireAuth: true,
  requireFeatures: ['marketing_automation.campaigns.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Getting started',
  pageTitleKey: 'marketing_automation.setup.title',
  /**
   * First in the group, ahead of Campaigns.
   *
   * This is the screen that answers "why did nothing send", and it declared no order at all — so `nav.ts`
   * defaulted it to 10,000 and sorted by title, landing it FOURTH, behind Background jobs and Content blocks.
   * The one screen written for an installation that cannot send yet was the hardest in the group to find, and
   * nothing anywhere linked to it.
   */
  pageOrder: 5,
  breadcrumb: [
    { label: 'Getting started', labelKey: 'marketing_automation.setup.title' },
  ],
}
