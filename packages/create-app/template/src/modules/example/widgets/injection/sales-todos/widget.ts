import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import SalesTodosWidget from './widget.client'

const widget: InjectionWidgetModule<{ kind?: 'order' | 'quote'; record?: any }> = {
  metadata: {
    id: 'example.injection.sales-todos',
    title: 'Sales todos (example)',
    description: 'Adds a demo todos tab to sales quotes and orders.',
    features: ['example.todos.view'],
  },
  Widget: SalesTodosWidget,
}

export default widget
