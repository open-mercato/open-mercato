import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:nav:badges': [
    {
      widgetId: 'ai_assistant.injection.pending-actions-nav-badge',
      priority: 50,
    },
  ],
}

export default injectionTable
