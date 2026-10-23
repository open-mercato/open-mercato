export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.view'],
  pageTitle: 'Pending AI action',
  pageTitleKey: 'ai_assistant.pendingActions.detail.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    {
      label: 'Pending AI actions',
      labelKey: 'ai_assistant.pendingActions.navTitle',
      href: '/backend/config/ai-assistant/pending-actions',
    },
    { label: 'Action', labelKey: 'ai_assistant.pendingActions.detail.breadcrumb' },
  ],
} as const
