import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import XeroTabWidget from './widget.client'
import type { XeroTabContext } from './types'

const widget: InjectionWidgetModule<XeroTabContext> = {
  metadata: {
    id: 'sync_xero.injection.xero-tab',
    title: 'Xero',
    features: ['integrations.view'],
    priority: 100,
  },
  Widget: XeroTabWidget,
}

export default widget
