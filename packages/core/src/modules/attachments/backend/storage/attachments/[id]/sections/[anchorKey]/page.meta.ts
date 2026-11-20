export const metadata = {
  requireAuth: true,
  requireFeatures: ['attachments.view'],
  pageTitle: 'Cited section',
  pageTitleKey: 'attachments.structure.citation.title',
  pageGroup: 'Media',
  pageGroupKey: 'attachments.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Attachments', labelKey: 'attachments.library.title', href: '/backend/storage/attachments' },
    { label: 'Cited section', labelKey: 'attachments.structure.citation.title' },
  ],
} as const
