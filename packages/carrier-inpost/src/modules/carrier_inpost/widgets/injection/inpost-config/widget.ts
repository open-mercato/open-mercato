import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import InpostConfigWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'carrier_inpost.injection.config',
    title: 'InPost Settings',
    features: ['carrier_inpost.configure'],
    priority: 100,
  },
  Widget: InpostConfigWidget,
}

export default widget
