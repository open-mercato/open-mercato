import * as React from 'react'
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import EudrProductColumnWidget, { type EudrProductColumnValue } from './widget.client'

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'eudr.injection.product-column',
    title: 'EUDR product column',
    description: 'Renders EUDR commodity and scope information on catalog product lists.',
    features: ['eudr.mappings.view'],
    priority: 50,
    enabled: true,
  },
  columns: [
    {
      id: 'eudr.product-column',
      header: 'eudr.productColumn.header',
      accessorKey: '_eudr',
      size: 180,
      sortable: false,
      cell: ({ getValue }) => {
        return React.createElement(EudrProductColumnWidget, {
          value: getValue() as EudrProductColumnValue,
        })
      },
    },
  ],
}

export default widget
