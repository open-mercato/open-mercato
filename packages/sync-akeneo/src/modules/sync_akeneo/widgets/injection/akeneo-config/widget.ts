
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AkeneoConfigWidget from './widget.client'

const widget: InjectionWidgetModule<{
  state?: {
    isEnabled?: boolean
  } | null
}, {
  hasCredentials?: boolean
}> = {
  metadata: {
    id: 'sync_akeneo.injection.config',
    title: 'Akeneo Sync Settings',
    features: ['data_sync.configure'],
    priority: 100,
  },
  Widget: AkeneoConfigWidget,
}

export default widget
