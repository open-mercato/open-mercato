import React from 'react'

const createIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
  React.createElement('line', { x1: 19, y1: 8, x2: 19, y2: 14 }),
  React.createElement('line', { x1: 16, y1: 11, x2: 22, y2: 11 })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['instructors.manage'],
  pageTitle: 'Add Instructor',
  pageTitleKey: 'instructors.create.title',
  pageGroup: 'Instructors',
  pageGroupKey: 'instructors.nav.group',
  pagePriority: 20,
  pageOrder: 105,
  icon: createIcon,
  breadcrumb: [
    { label: 'Instructors', labelKey: 'instructors.nav.instructors', href: '/backend/instructors' },
    { label: 'Add Instructor', labelKey: 'instructors.create.title' },
  ],
}
