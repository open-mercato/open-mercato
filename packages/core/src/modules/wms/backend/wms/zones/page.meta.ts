import React from 'react'
import { Layers } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Zones',
  pageTitleKey: 'wms.backend.zones.nav.title',
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Zones', labelKey: 'wms.backend.zones.nav.title' },
  ],
  icon: React.createElement(Layers, { size: 16 }),
} as const
