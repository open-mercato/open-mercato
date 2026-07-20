import React from 'react'
import { FileText } from 'lucide-react'

const documentsTemplatesIcon = React.createElement(FileText, { size: 16 })

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
