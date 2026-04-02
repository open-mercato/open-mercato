import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const syncExcelDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('sync_excel')

export const integration: IntegrationDefinition = {
  id: 'sync_excel',
  title: 'Excel / CSV Import',
  description: 'Upload CSV files, preview mappings, and run file-based imports through Data Sync.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: 'excel',
  icon: 'file-spreadsheet',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['excel', 'csv', 'file-upload', 'import', 'spreadsheet'],
  detailPage: {
    widgetSpotId: syncExcelDetailWidgetSpotId,
  },
  defaultState: {
    isEnabled: true,
  },
  credentials: {
    fields: [],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
