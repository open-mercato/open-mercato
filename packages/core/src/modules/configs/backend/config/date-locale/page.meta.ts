import React from 'react'

const calendarIcon = React.createElement(
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
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }),
  React.createElement('path', { d: 'M16 2v4' }),
  React.createElement('path', { d: 'M8 2v4' }),
  React.createElement('path', { d: 'M3 10h18' }),
  React.createElement('path', { d: 'M12 14v3l2 1' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['configs.date_locale.view'],
  pageTitle: 'Date & time',
  pageTitleKey: 'configs.config.nav.dateLocale',
  pageGroup: 'System',
  pageGroupKey: 'settings.sections.system',
  pageOrder: 4,
  icon: calendarIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Date & time', labelKey: 'configs.config.nav.dateLocale' },
  ],
} as const
