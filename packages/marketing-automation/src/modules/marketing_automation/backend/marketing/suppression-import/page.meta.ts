import React from 'react'

const suppressionImportIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M12 3v12' }),
  React.createElement('path', { d: 'M7 10l5 5 5-5' }),
  React.createElement('path', { d: 'M4 19h16' }),
)

/**
 * Its own page, gated on `consent.manage` alone — not folded into the settings screen, which is gated on
 * `campaigns.manage`. Whoever answers "take me off every list you got from our old tool" should be able to
 * do that without also being able to author campaigns that message everybody, the same reasoning
 * `api/customers/[id]/consent/route.ts` gives for its own grant. The settings page's GET also requires
 * `campaigns.view`, which a consent-only grant does not carry — a page living under that load would show a
 * consent-only admin nothing but an error, not a working import, so the control needs a load path of its
 * own rather than a loosened settings gate.
 */
export const metadata = {
  icon: suppressionImportIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.consent.manage'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Import suppression list',
  pageTitleKey: 'marketing_automation.suppressionImport.title',
  breadcrumb: [
    { label: 'Import suppression list', labelKey: 'marketing_automation.suppressionImport.title' },
  ],
}
