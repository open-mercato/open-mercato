import React from 'react'
import { PlugZap } from 'lucide-react'

const integrationsIcon = React.createElement(PlugZap, { width: 16, height: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['integrations.view'],
  pageTitle: 'Integrations',
  pageTitleKey: 'integrations.nav.title',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageOrder: 50,
  icon: integrationsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Integrations', labelKey: 'integrations.nav.title' }],
}
