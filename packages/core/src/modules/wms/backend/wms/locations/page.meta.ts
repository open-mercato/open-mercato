import React from 'react'
import { MapPinned } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Locations',
  pageTitleKey: 'wms.backend.locations.nav.title',
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Locations', labelKey: 'wms.backend.locations.nav.title' },
  ],
  icon: React.createElement(MapPinned, { size: 16 }),
} as const
