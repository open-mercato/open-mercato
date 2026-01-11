export const metadata = {
  title: 'Freight Offers',
  description: 'Manage customer-facing freight offers',
  requireAuth: true,
  requireFeatures: ['fms_quotes.offers.view'],
  nav: {
    group: 'Freight',
    label: 'Offers',
    icon: 'FileText',
    order: 35,
    parent: 'fms-quotes',
  },
}
