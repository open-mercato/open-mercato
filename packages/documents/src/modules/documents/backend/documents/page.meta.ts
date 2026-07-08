import React from 'react'
import { FileText } from 'lucide-react'

const documentsIcon = React.createElement(FileText, { size: 16 })

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
