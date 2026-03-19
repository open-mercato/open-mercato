import React from 'react'
import { ReceiptText } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Transactions',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 82,
  icon: React.createElement(ReceiptText, { size: 16 }),
  breadcrumb: [
    { label: 'Checkout', href: '/backend/checkout' },
    { label: 'Transactions' },
  ],
}
