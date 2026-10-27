import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import SalesOrderStockContextWidget, { type SalesOrderRecord } from './widget.client'

const widget: InjectionWidgetModule<unknown, SalesOrderRecord> = {
  metadata: {
    id: 'wms.injection.sales-order-stock-context',
    title: 'WMS stock context',
    description: 'Shows reservation and stock summary on sales orders',
    features: ['wms.view'],
    priority: 80,
  },
  Widget: SalesOrderStockContextWidget,
}

export default widget
