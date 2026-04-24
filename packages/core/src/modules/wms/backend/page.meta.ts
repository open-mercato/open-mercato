import React from 'react'
import { Warehouse } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS',
  pageTitleKey: 'wms.backend.nav.title',
  pageGroup: 'Operations',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 45,
  pageOrder: 95,
  icon: React.createElement(Warehouse, { size: 16 }),
  breadcrumb: [{ label: 'WMS', labelKey: 'wms.backend.nav.title' }],
} as const
