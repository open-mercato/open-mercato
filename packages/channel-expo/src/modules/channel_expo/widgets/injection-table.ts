import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  // Tenant-wide connect entry on the shared channels admin DataTable toolbar.
  'data-table:communication_channels.channels:toolbar': [
    {
      widgetId: 'channel_expo.injection.connect',
      priority: 80,
    },
  ],
}

export default injectionTable
