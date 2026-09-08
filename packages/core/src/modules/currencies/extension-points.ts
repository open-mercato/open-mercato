import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'currencies',
  hosts: {
    currenciesTable: dataTableExtensionHost({ tableId: 'currencies.list', source: 'backend/currencies/page.tsx' }),
    exchangeRatesTable: dataTableExtensionHost({ tableId: 'exchange-rates.list', source: 'backend/exchange-rates/page.tsx' }),
  },
})

export default extensionPoints
