import React from 'react'
import type { RouteVisibilityContext } from '@open-mercato/shared/modules/registry'
import { isSalesChannelsEnabledForTenant } from '../../../../lib/salesChannelsToggle'

const globeIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('path', { d: 'M2 12h20' }),
  React.createElement('path', { d: 'M12 2a15 15 0 0 1 0 20' }),
  React.createElement('path', { d: 'M12 2a15 15 0 0 0 0 20' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channels.manage'],
  visible: (ctx: RouteVisibilityContext) => isSalesChannelsEnabledForTenant(ctx.auth?.tenantId ?? null),
  pageTitle: 'Sales channel offers',
  pageTitleKey: 'sales.channels.offers.listTitle',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 125,
  icon: globeIcon,
  breadcrumb: [
    { label: 'Sales', labelKey: 'customers~sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channels.nav.title', href: '/backend/sales/channels' },
    { label: 'Offers', labelKey: 'sales.channels.offers.listTitle' },
  ],
} as const
