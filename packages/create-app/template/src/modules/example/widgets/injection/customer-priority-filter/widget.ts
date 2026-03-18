import type { InjectionFilterWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionFilterWidget = {
  metadata: {
    id: 'example.injection.customer-priority-filter',
    priority: 35,
  },
  filters: [
    {
      id: 'examplePriority',
      label: 'example.priority.filter',
      type: 'select',
      strategy: 'server',
      queryParam: 'examplePriority',
      options: [
        { value: 'low', label: 'example.priority.low' },
        { value: 'normal', label: 'example.priority.normal' },
        { value: 'high', label: 'example.priority.high' },
        { value: 'critical', label: 'example.priority.critical' },
      ],
    },
  ],
}

export default widget
