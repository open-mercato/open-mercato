import React from 'react'

const sidebarCustomizeIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { x: 3, y: 3, width: 7, height: 18, rx: 1 }),
  React.createElement('rect', { x: 14, y: 3, width: 7, height: 11, rx: 1 }),
  React.createElement('path', { d: 'M14 17h7' }),
  React.createElement('path', { d: 'M17.5 14v7' }),
)

// Page is reachable by any authenticated user — every staff user has
// always been able to customize their PERSONAL sidebar (the variants /
// preferences APIs gate only role-application via `auth.sidebar.manage`).
// Inside the editor, the "Apply to roles" card and role variants picker are
// already conditionally hidden via `canApplyToRoles` (server-checked against
// `auth.sidebar.manage`), so non-admins see only the personal-scope flow,
// matching the pre-PR inline-editor behavior. Restricting the whole page
// to `auth.sidebar.manage` would be a stealth regression for non-admins.
export const metadata = {
  requireAuth: true,
  pageTitle: 'Customize sidebar',
  pageTitleKey: 'appShell.customizeSidebar',
  pageGroup: 'Customization',
  pageGroupKey: 'appShell.sidebarCustomizationGroup',
  pageOrder: 1,
  icon: sidebarCustomizeIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Customize sidebar', labelKey: 'appShell.customizeSidebar' },
  ],
}

export default metadata
