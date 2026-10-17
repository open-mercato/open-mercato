export const metadata = {
  requireAuth: true,
  requireFeatures: ['insights.xray.manage'],
  pageTitle: 'Process X-Ray settings',
  pageTitleKey: 'insights.xray.ui.nav.settings',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 60,
  icon: 'git-branch',
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Process X-Ray', labelKey: 'insights.xray.ui.nav.title', href: '/backend/insights/process-xray' },
    { label: 'Settings', labelKey: 'insights.xray.ui.nav.settings' },
  ],
}

export default metadata
