import React from 'react'
import { AlertTriangle } from 'lucide-react'

const incidentIcon = React.createElement(AlertTriangle, { size: 16, 'aria-hidden': true })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['incidents.incident.create'],
  pageTitle: 'Declare incident',
  pageTitleKey: 'incidents.incident.create.title',
  pageGroup: 'Operations',
  pageGroupKey: 'incidents.nav.group',
  pagePriority: 20,
  pageOrder: 105,
  icon: incidentIcon,
  breadcrumb: [
    { label: 'Incidents', labelKey: 'incidents.nav.incidents', href: '/backend/incidents' },
    { label: 'Declare incident', labelKey: 'incidents.incident.create.title' },
  ],
}
