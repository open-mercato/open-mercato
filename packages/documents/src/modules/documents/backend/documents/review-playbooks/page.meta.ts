import React from 'react'

const reviewPlaybooksIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }),
  React.createElement('path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }),
  React.createElement('path', { d: 'm9 15 2 2 4-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['documents.review_playbooks.manage'],
  pageTitle: 'Review playbooks',
  pageTitleKey: 'documents.reviewPlaybooks.nav.title',
  pageGroup: 'Documents',
  pageGroupKey: 'documents.nav.group',
  pagePriority: 40,
  pageOrder: 120,
  icon: reviewPlaybooksIcon,
  breadcrumb: [
    { label: 'Documents', labelKey: 'documents.nav.documents' },
    { label: 'Review playbooks', labelKey: 'documents.reviewPlaybooks.nav.title' },
  ],
}
