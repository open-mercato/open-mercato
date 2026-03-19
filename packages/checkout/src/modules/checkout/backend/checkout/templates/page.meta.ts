import React from 'react'
import { LayoutTemplate } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Templates',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 81,
  icon: React.createElement(LayoutTemplate, { size: 16 }),
  breadcrumb: [
    { label: 'Checkout', href: '/backend/checkout' },
    { label: 'Templates' },
  ],
}
