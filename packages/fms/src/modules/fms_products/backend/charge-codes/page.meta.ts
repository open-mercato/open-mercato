import React from 'react'

const chargeCodeIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', { d: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['fms_products.charge_codes.view'],
  pageTitle: 'Charge Codes',
  pageTitleKey: 'fms_products.nav.charge_codes',
  pageGroup: 'FMS',
  pageGroupKey: 'fms_quotes.nav.group',
  pagePriority: 50,
  pageOrder: 120,
  icon: chargeCodeIcon,
  breadcrumb: [{ label: 'Charge Codes', labelKey: 'fms_products.nav.charge_codes' }],
}
