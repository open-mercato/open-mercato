import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PaymentTransactionLinkWidget from './widget.client'
import { normalizePaymentLinkDraft, validatePaymentLinkDraft } from './payment-link-draft'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'payment_link_pages.injection.transaction-create-link',
    title: 'Payment link',
    features: ['payment_gateways.manage'],
    priority: 90,
  },
  Widget: PaymentTransactionLinkWidget,
  eventHandlers: {
    onBeforeSave: async (data) => {
      const errors = validatePaymentLinkDraft(data?.paymentLink)
      if (errors.length === 0) return { ok: true }
      return {
        ok: false,
        message: errors[0],
      }
    },
    transformFormData: async (data) => {
      const next = { ...(data ?? {}) }
      const paymentLink = normalizePaymentLinkDraft(next.paymentLink)
      if (paymentLink) {
        next.paymentLink = paymentLink
      } else {
        delete next.paymentLink
      }
      return next
    },
  },
}

export default widget
