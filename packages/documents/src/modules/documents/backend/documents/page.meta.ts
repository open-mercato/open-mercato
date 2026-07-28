import React from 'react'

// Page metadata must stay a plain serializable element tree — a lucide component
// reference does not survive metadata serialization and drops the sidebar icon.
const documentsIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }),
  React.createElement('path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }),
  React.createElement('path', { d: 'M10 9H8' }),
  React.createElement('path', { d: 'M16 13H8' }),
  React.createElement('path', { d: 'M16 17H8' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['documents.view'],
  pageTitle: 'Documents',
  pageTitleKey: 'documents.nav.documents',
  pageGroup: 'Documents',
  pageGroupKey: 'documents.nav.group',
  pagePriority: 40,
  pageOrder: 100,
  icon: documentsIcon,
  breadcrumb: [{ label: 'Documents', labelKey: 'documents.nav.documents' }],
}
