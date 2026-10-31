import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import RecurrenceSectionWidget from './widget.client'

const widget: InjectionWidgetModule<{ kind?: 'order' | 'quote' }, { id: string }> = {
  metadata: {
    id: 'sales.injection.recurrence-section',
    title: 'Recurrence',
    description: 'Recurring schedule of a quote or order',
    priority: 300,
  },
  Widget: RecurrenceSectionWidget,
}

export default widget
