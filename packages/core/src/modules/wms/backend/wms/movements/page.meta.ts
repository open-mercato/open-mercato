import React from 'react'
import { Route } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Movements',
  pageTitleKey: 'wms.backend.movements.nav.title',
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Movements', labelKey: 'wms.backend.movements.nav.title' },
  ],
  icon: React.createElement(Route, { size: 16 }),
} as const
