import React from 'react'
import { AlertTriangle } from 'lucide-react'

const incidentIcon = React.createElement(AlertTriangle, { size: 16, 'aria-hidden': true })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['incidents.incident.view'],
  pageTitle: 'Incident detail',
  pageTitleKey: 'incidents.incident.detail.title',
  navHidden: true,
  icon: incidentIcon,
  breadcrumb: [
    { label: 'Incidents', labelKey: 'incidents.nav.incidents', href: '/backend/incidents' },
    { label: 'Incident detail', labelKey: 'incidents.incident.detail.title' },
  ],
}
