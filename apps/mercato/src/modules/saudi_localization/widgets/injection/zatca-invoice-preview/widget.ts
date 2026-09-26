import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ZatcaInvoicePreviewWidget from './widget.client'
import type { ZatcaInvoiceRecord } from '../zatca-qr/widget.client'

const widget: InjectionWidgetModule<unknown, ZatcaInvoiceRecord> = {
  metadata: {
    id: 'saudi_localization.injection.zatca-invoice-preview',
    title: 'ZATCA invoice preview',
    description: 'Builds the UBL 2.1 invoice a sales order would produce, without issuing it.',
    features: ['saudi_localization.settings.view'],
    priority: 75,
  },
  Widget: ZatcaInvoicePreviewWidget,
}

export default widget
