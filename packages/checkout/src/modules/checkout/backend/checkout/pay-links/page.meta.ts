import React from 'react'
import { Link2 } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Pay Links',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 80,
  icon: React.createElement(Link2, { size: 16 }),
  breadcrumb: [
    { label: 'Checkout', href: '/backend/checkout' },
    { label: 'Pay Links' },
  ],
}
