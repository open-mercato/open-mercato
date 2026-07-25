export const metadata = {
  requireAuth: true,
  requireFeatures: ['attachments.view'],
  pageTitle: 'Attachments',
  pageTitleKey: 'attachments.library.title',
  pageGroup: 'Media',
  pageGroupKey: 'attachments.nav.group',
  pagePriority: 20,
  pageOrder: 110,
  icon: 'archive',
  breadcrumb: [
    { label: 'Attachments', labelKey: 'attachments.library.title' },
  ],
} as const
