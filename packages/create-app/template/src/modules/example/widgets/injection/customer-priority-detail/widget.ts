import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CustomerPriorityDetailWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.customer-priority-detail',
    title: 'Customer Priority',
    priority: 40,
  },
  Widget: CustomerPriorityDetailWidget,
}

export default widget
