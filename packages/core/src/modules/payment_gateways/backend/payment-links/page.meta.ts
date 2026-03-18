import { Link2 } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['payment_gateways.view'],
  pageTitleKey: 'payment_gateways.links.title',
  pageGroup: 'Payments',
  pageGroupKey: 'payment_gateways.nav.paymentsGroup',
  pageOrder: 20,
  icon: Link2,
}
