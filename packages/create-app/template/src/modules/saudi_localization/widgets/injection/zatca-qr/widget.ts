import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ZatcaQrWidget, { type ZatcaInvoiceRecord } from './widget.client'

const widget: InjectionWidgetModule<unknown, ZatcaInvoiceRecord> = {
  metadata: {
    id: 'saudi_localization.injection.zatca-qr',
    title: 'ZATCA invoice QR',
    description: 'Shows the ZATCA Phase 1 QR payload a Saudi tax invoice must carry, or explains why it is missing.',
    features: ['saudi_localization.settings.view'],
    priority: 70,
  },
  Widget: ZatcaQrWidget,
}

export default widget
