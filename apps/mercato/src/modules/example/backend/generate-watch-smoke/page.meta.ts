import React from 'react'
import { RefreshCw } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.backend'],
  pageTitle: 'Generate Watch Smoke',
  pageTitleKey: 'example.generateWatchSmoke.title',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20005,
  icon: React.createElement(RefreshCw, { size: 16 }),
  breadcrumb: [
    { label: 'Generate Watch Smoke', labelKey: 'example.generateWatchSmoke.title' },
  ],
}

export default metadata
