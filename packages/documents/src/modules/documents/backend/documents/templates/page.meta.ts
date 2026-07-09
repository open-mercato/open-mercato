import React from 'react'
import { FileText } from 'lucide-react'

const documentsTemplatesIcon = React.createElement(FileText, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['documents.view'],
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
