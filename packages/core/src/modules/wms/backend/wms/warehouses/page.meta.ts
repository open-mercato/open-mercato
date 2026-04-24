import React from 'react'
import { Warehouse } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Warehouses',
  pageTitleKey: 'wms.backend.warehouses.nav.title',
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Warehouses', labelKey: 'wms.backend.warehouses.nav.title' },
  ],
  icon: React.createElement(Warehouse, { size: 16 }),
} as const
