import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import StripeConfigWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'gateway_stripe.injection.config',
    title: 'Stripe Settings',
    features: ['gateway_stripe.configure'],
    priority: 100,
  },
  Widget: StripeConfigWidget,
  eventHandlers: {
    onBeforeSave: async (data) => {
      const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      const captureMethod = payload.captureMethod
      if (captureMethod !== undefined && captureMethod !== 'automatic' && captureMethod !== 'manual') {
        return { ok: false, message: 'Capture method must be automatic or manual' }
      }
      return { ok: true }
    },
  },
}

export default widget
