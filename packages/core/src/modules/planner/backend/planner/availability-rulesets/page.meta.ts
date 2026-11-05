import React from 'react'

const scheduleIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' }),
  React.createElement('path', { d: 'M16 2v4' }),
  React.createElement('path', { d: 'M8 2v4' }),
  React.createElement('path', { d: 'M3 10h18' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['planner.manage_availability'],
  pageTitle: 'Availability schedules',
  pageTitleKey: 'planner.availabilityRuleSets.page.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 9,
  icon: scheduleIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Availability schedules', labelKey: 'planner.availabilityRuleSets.page.title' }],
}
