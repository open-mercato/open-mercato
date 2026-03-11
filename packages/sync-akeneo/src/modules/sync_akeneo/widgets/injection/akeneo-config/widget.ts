import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AkeneoConfigWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'sync_akeneo.injection.config',
    title: 'Akeneo Sync Settings',
    features: ['sync_akeneo.configure'],
    priority: 100,
  },
  Widget: AkeneoConfigWidget,
}

export default widget
