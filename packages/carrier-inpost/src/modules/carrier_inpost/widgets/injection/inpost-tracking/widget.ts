import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import InpostTrackingWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'carrier_inpost.injection.tracking',
    title: 'InPost Tracking',
    features: ['carrier_inpost.view'],
    priority: 50,
  },
  Widget: InpostTrackingWidget,
}

export default widget
