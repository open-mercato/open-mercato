import React from 'react'
import { FileText } from 'lucide-react'

const postmortemsIcon = React.createElement(FileText, { size: 16, 'aria-hidden': true })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['incidents.postmortem.view'],
  pageTitle: 'Incident postmortems',
  pageTitleKey: 'incidents.nav.postmortems',
  pageGroup: 'Operations',
  pageGroupKey: 'incidents.nav.group',
  pagePriority: 20,
  pageOrder: 101,
  icon: postmortemsIcon,
  breadcrumb: [
    { label: 'Incidents', labelKey: 'incidents.nav.incidents', href: '/backend/incidents' },
    { label: 'Postmortems', labelKey: 'incidents.nav.postmortems' },
  ],
}
