import React from 'react'
import { Users } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['contractors.view'],
  pageTitle: 'Contractors',
  pageTitleKey: 'contractors.list.title',
  pageGroup: 'FMS',
  pageGroupKey: 'fms.nav.group',
  pagePriority: 10,
  pageOrder: 100,
  icon: React.createElement(Users, { size: 16 }),
  breadcrumb: [{ label: 'Contractors', labelKey: 'contractors.list.title' }],
}
