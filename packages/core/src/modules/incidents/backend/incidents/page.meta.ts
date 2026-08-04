import React from 'react'
import { AlertTriangle } from 'lucide-react'

const incidentIcon = React.createElement(AlertTriangle, { size: 16, 'aria-hidden': true })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['incidents.incident.view'],
  pageTitle: 'Incidents',
  pageTitleKey: 'incidents.nav.incidents',
  pageGroup: 'Operations',
  pageGroupKey: 'incidents.nav.group',
  pagePriority: 20,
  pageOrder: 100,
  icon: incidentIcon,
  breadcrumb: [{ label: 'Incidents', labelKey: 'incidents.nav.incidents' }],
}
