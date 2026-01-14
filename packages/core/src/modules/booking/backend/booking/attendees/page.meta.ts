import React from 'react'

const attendeeIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 9, cy: 7, r: 3 }),
  React.createElement('path', { d: 'M4 20c0-3 2.5-5 5-5' }),
  React.createElement('path', { d: 'M16 3v4' }),
  React.createElement('path', { d: 'M16 13v4' }),
  React.createElement('path', { d: 'M16 7h5' }),
  React.createElement('path', { d: 'M16 17h5' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_events'],
  pageTitle: 'Attendees',
  pageTitleKey: 'booking.attendees.page.title',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 90,
  icon: attendeeIcon,
  breadcrumb: [{ label: 'Attendees', labelKey: 'booking.attendees.page.title' }],
}
