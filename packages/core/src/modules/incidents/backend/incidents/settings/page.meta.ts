import React from 'react'
import { Settings } from 'lucide-react'

const settingsIcon = React.createElement(Settings, { size: 16, 'aria-hidden': true })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['incidents.settings.manage'],
  pageTitle: 'Incident settings',
  pageTitleKey: 'incidents.settings.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'incidents.settings.pageGroup',
  pageOrder: 50,
  icon: settingsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Incident settings', labelKey: 'incidents.settings.title' }],
}

export default metadata
