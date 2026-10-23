import React from 'react'

const routingIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M4 6h6l4 6h6' }),
  React.createElement('path', { d: 'M4 18h6l4-6' }),
)

export const metadata = {
  icon: routingIcon,
  requireAuth: true,
  // Mirrors `api/lead-routing/route.ts`'s GET requirement exactly: that route also needs
  // `customers.people.view`, because the list it answers includes decrypted customer names. Without this
  // here, a role holding `runs.view` alone saw the nav entry and the page, then watched every row load fail.
  requireFeatures: ['marketing_automation.runs.view', 'customers.people.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Lead routing',
  pageTitleKey: 'marketing_automation.routing.title',
  breadcrumb: [
    { label: 'Lead routing', labelKey: 'marketing_automation.routing.title' },
  ],
}
