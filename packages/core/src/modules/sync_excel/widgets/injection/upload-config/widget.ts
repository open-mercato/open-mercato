import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import SyncExcelUploadConfigWidget from './widget.client'

type SyncExcelIntegrationContext = {
  formId?: string
  integrationDetailWidgetSpotId?: string
  integrationId?: string
  activeTab?: string
  refreshDetail?: () => Promise<void>
  refreshLogs?: () => Promise<void>
  refreshHealthSnapshot?: () => Promise<void>
}

type SyncExcelIntegrationData = {
  state?: {
    isEnabled?: boolean
  } | null
}

const widget: InjectionWidgetModule<SyncExcelIntegrationContext, SyncExcelIntegrationData> = {
  metadata: {
    id: 'sync_excel.injection.upload-config',
    title: 'CSV Import',
    features: ['sync_excel.view'],
    priority: 100,
  },
  Widget: SyncExcelUploadConfigWidget,
}

export default widget
