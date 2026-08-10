import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

// Use this pattern when you want to embed TemplatesList in a custom slot —
// for example a shipment detail page or any resource that is NOT sales orders
// or quotes. Those two are already handled by the built-in document-generators
// widgets; adding a second widget for the same slot would produce duplicate tabs.
// Replace the slot key below with the one defined by the target host module.
export const injectionTable: ModuleInjectionTable = {
  'my-module.custom.resource:tabs': [
    {
      widgetId: 'example.injection.order_pdf_tab',
      kind: 'tab',
      priority: 10,
    },
  ],
}

export default injectionTable
