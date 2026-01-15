import React from 'react'

const documentIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }),
  React.createElement('path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }),
  React.createElement('path', { d: 'M10 9H8' }),
  React.createElement('path', { d: 'M16 13H8' }),
  React.createElement('path', { d: 'M16 17H8' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['fms_documents.view'],
  pageTitle: 'Documents',
  pageTitleKey: 'fms_documents.nav.documents',
  pageGroup: 'FMS',
  pageGroupKey: 'fms_quotes.nav.group',
  pagePriority: 50,
  pageOrder: 115,
  icon: documentIcon,
  breadcrumb: [{ label: 'Documents', labelKey: 'fms_documents.nav.documents' }],
}
