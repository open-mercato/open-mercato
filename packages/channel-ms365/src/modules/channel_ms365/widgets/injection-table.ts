import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'profile:communication-channels:connect': [
    {
      widgetId: 'channel_ms365.injection.connect',
      priority: 110,
    },
  ],
}

export default injectionTable
