import React from 'react'
import { ReceiptText } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Transactions',
  pageTitleKey: 'checkout.nav.transactions',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 82,
  icon: React.createElement(ReceiptText, { size: 16 }),
  breadcrumb: [
    { label: 'Checkout', labelKey: 'checkout.nav.root', href: '/backend/checkout' },
    { label: 'Transactions', labelKey: 'checkout.nav.transactions' },
  ],
}
