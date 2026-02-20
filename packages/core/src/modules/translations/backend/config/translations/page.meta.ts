import React from 'react'

const translationsIcon = React.createElement(
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
  React.createElement('path', { d: 'm5 8 6 6' }),
  React.createElement('path', { d: 'm4 14 6-6 2-3' }),
  React.createElement('path', { d: 'M2 5h12' }),
  React.createElement('path', { d: 'M7 2h1' }),
  React.createElement('path', { d: 'm22 22-5-10-5 10' }),
  React.createElement('path', { d: 'M14 18h6' })
)

export const metadata = {
  requireAuth: true,
  pageTitle: 'Translations',
  pageTitleKey: 'translations.config.nav.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 7,
  icon: translationsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Translations', labelKey: 'translations.config.nav.title' },
  ],
} as const
