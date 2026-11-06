export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.runs.view'],
  pageTitle: 'Run details',
  pageTitleKey: 'ai_assistant.runs.detail.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    {
      label: 'Agent runs',
      labelKey: 'ai_assistant.runs.navTitle',
      href: '/backend/config/ai-assistant/runs',
    },
    { label: 'Run', labelKey: 'ai_assistant.runs.detail.breadcrumb' },
  ],
} as const
