import React from 'react'
import { LayoutTemplate } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Templates',
  pageTitleKey: 'checkout.nav.templates',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 81,
  icon: React.createElement(LayoutTemplate, { size: 16 }),
  breadcrumb: [
    { label: 'Checkout', labelKey: 'checkout.nav.root', href: '/backend/checkout' },
    { label: 'Templates', labelKey: 'checkout.nav.templates' },
  ],
}
