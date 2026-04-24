import React from 'react'
import { ShieldCheck } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Reservations',
  pageTitleKey: 'wms.backend.reservations.nav.title',
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Reservations', labelKey: 'wms.backend.reservations.nav.title' },
  ],
  icon: React.createElement(ShieldCheck, { size: 16 }),
} as const
