import { dataTableExtensionHost, defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'payment_gateways',
  hosts: {
    transactionsTable: dataTableExtensionHost({ tableId: 'payment_gateways.transactions.list', source: 'backend/payment-gateways/page.tsx' }),
    transactionsAfter: injectionExtensionHost({
      family: 'detail',
      spotId: 'admin.page:payment-gateways/transactions:after',
      supported: ['render-widget'],
      source: 'backend/payment-gateways/page.tsx',
    }),
  },
})

export default extensionPoints
