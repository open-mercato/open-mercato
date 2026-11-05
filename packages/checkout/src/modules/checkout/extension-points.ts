import {
  componentExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

const payPageSpot = (spotId: string) => injectionExtensionHost({
  family: 'detail',
  spotId,
  supported: ['render-widget'],
  contextContract: 'checkout.pay-page.v1',
  source: 'components/PayPage.tsx',
})

const payPageComponent = (componentId: string) => componentExtensionHost({
  componentId,
  propsContract: 'checkout.pay-page.v1',
  source: 'components/PayPage.tsx',
})

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'checkout',
  hosts: {
    linksTable: dataTableExtensionHost({ tableId: 'checkout-links', source: 'backend/checkout/pay-links/page.tsx' }),
    templatesTable: dataTableExtensionHost({ tableId: 'checkout-templates', source: 'backend/checkout/templates/page.tsx' }),
    transactionsTable: dataTableExtensionHost({ tableId: 'checkout-transactions', source: 'backend/checkout/transactions/page.tsx' }),
    gatewayWidgetBefore: payPageSpot('checkout.pay-page:gateway-widget:before'),
    gatewayRendererBefore: payPageSpot('checkout.pay-page:gateway-widget:renderer:before'),
    gatewayRendererAfter: payPageSpot('checkout.pay-page:gateway-widget:renderer:after'),
    gatewayActionsBefore: payPageSpot('checkout.pay-page:gateway-widget:actions:before'),
    gatewayActionsAfter: payPageSpot('checkout.pay-page:gateway-widget:actions:after'),
    gatewayWidgetAfter: payPageSpot('checkout.pay-page:gateway-widget:after'),
    headerBefore: payPageSpot('checkout.pay-page:header:before'),
    headerAfter: payPageSpot('checkout.pay-page:header:after'),
    descriptionAfter: payPageSpot('checkout.pay-page:description:after'),
    customerFieldsBefore: payPageSpot('checkout.pay-page:customer-fields:before'),
    customerFieldsAfter: payPageSpot('checkout.pay-page:customer-fields:after'),
    pricingBefore: payPageSpot('checkout.pay-page:pricing:before'),
    pricingAfter: payPageSpot('checkout.pay-page:pricing:after'),
    summaryBefore: payPageSpot('checkout.pay-page:summary:before'),
    summaryAfter: payPageSpot('checkout.pay-page:summary:after'),
    legalConsentBefore: payPageSpot('checkout.pay-page:legal-consent:before'),
    legalConsentAfter: payPageSpot('checkout.pay-page:legal-consent:after'),
    submitBefore: payPageSpot('checkout.pay-page:submit:before'),
    submitAfter: payPageSpot('checkout.pay-page:submit:after'),
    helpBefore: payPageSpot('checkout.pay-page:help:before'),
    helpAfter: payPageSpot('checkout.pay-page:help:after'),
    paymentBefore: payPageSpot('checkout.pay-page:payment:before'),
    paymentAfter: payPageSpot('checkout.pay-page:payment:after'),
    footerBefore: payPageSpot('checkout.pay-page:footer:before'),
    footerAfter: payPageSpot('checkout.pay-page:footer:after'),
    payPage: payPageComponent('page:checkout.pay-page'),
    header: payPageComponent('section:checkout.pay-page.header'),
    description: payPageComponent('section:checkout.pay-page.description'),
    summary: payPageComponent('section:checkout.pay-page.summary'),
    pricing: payPageComponent('section:checkout.pay-page.pricing'),
    payment: payPageComponent('section:checkout.pay-page.payment'),
    customerForm: payPageComponent('section:checkout.pay-page.customer-form'),
    legalConsent: payPageComponent('section:checkout.pay-page.legal-consent'),
    gatewayForm: payPageComponent('section:checkout.pay-page.gateway-form'),
    help: payPageComponent('section:checkout.pay-page.help'),
    footer: payPageComponent('section:checkout.pay-page.footer'),
  },
})

export default extensionPoints
