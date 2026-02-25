import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { ComponentType } from 'react'
import StorefrontOrderSourceWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'ecommerce.injection.storefront-order-source',
    title: 'Storefront Order Source',
    description: 'Shows the storefront source (store and cart) for orders originating from the storefront.',
    priority: 100,
    enabled: true,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Widget: StorefrontOrderSourceWidget as ComponentType<any>,
}

export default widget
