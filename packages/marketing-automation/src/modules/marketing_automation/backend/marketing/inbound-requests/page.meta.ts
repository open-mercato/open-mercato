export const metadata = {
  icon: 'inbox',
  requireAuth: true,
  /**
   * `campaigns.manage`, not `campaigns.view`, which gates every other screen in this group.
   *
   * The rows hold the body a partner posted, verbatim, addresses included. Being allowed to see that hooks
   * exist is not the same as being allowed to read what came through them.
   */
  requireFeatures: ['marketing_automation.campaigns.manage'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Inbound requests',
  pageTitleKey: 'marketing_automation.inboundRequests.title',
  pageOrder: 85,
  breadcrumb: [
    { label: 'Inbound requests', labelKey: 'marketing_automation.inboundRequests.title' },
  ],
}
