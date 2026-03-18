import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'example.injection.customer-priority-column',
    priority: 40,
  },
  columns: [
    {
      id: 'example_priority',
      header: 'example.priority.column',
      accessorKey: '_example.priority',
      sortable: false,
      cell: ({ getValue }) => {
        const value = getValue()
        if (typeof value !== 'string' || value.trim().length === 0) return 'normal'
        return value
      },
    },
  ],
}

export default widget
