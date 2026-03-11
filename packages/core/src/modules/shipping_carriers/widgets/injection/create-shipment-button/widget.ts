import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'shipping_carriers.injection.create-shipment-button',
    priority: 30,
  },
  rowActions: [
    {
      id: 'create_shipment',
      label: 'shipping_carriers.action.createShipment',
      icon: 'Truck',
      onSelect: (row: unknown, context: unknown) => {
        const ctx = context as { navigate?: (path: string) => void }
        const order = row as { id?: string }
        if (ctx.navigate && order.id) {
          ctx.navigate(`/backend/shipping-carriers/create?orderId=${order.id}`)
        }
      },
    },
  ],
}

export default widget
