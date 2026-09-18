import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  // Tenant-wide connect entry on the shared channels admin DataTable toolbar.
  'data-table:communication_channels.channels:toolbar': [
    {
      widgetId: 'channel_fcm.injection.connect',
      priority: 100,
    },
  ],
}

export default injectionTable
