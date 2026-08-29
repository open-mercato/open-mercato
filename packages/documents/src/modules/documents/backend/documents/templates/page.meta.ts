import React from 'react'

// Page metadata must stay a plain serializable element tree — a lucide component
// reference does not survive metadata serialization and drops the sidebar icon.
const documentsTemplatesIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }),
  React.createElement('path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }),
  React.createElement('path', { d: 'M14 13H8' }),
  React.createElement('path', { d: 'M14 17H8' }),
  React.createElement('path', { d: 'M10 9H8' }),
)

export const metadata = {
  requireAuth: true,
  // The template list API stays on `documents.view` because the
  // new-from-template dialog needs it, but this page is the management
  // surface: every action on it, and the single-template read behind its
  // editor, require `documents.templates.manage`. Gate the page (and the nav
  // entry it registers) on the same feature instead of advertising a dead end.
  requireFeatures: ['documents.templates.manage'],
  pageTitle: 'Document templates',
  pageTitleKey: 'documents.nav.templates',
  pageGroup: 'Documents',
  pageGroupKey: 'documents.nav.group',
  pagePriority: 40,
  pageOrder: 110,
  icon: documentsTemplatesIcon,
  breadcrumb: [
    { label: 'Documents', labelKey: 'documents.nav.documents' },
    { label: 'Document templates', labelKey: 'documents.nav.templates' },
  ],
}
