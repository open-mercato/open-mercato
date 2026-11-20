export const integrationMeta = {
  description:
    'Autopay scheduled status reconciliation: schedule registration, scheduler dispatch, settled-payment capture and provider-error retry (TC-AUTOPAY-001..004)',
  dependsOnModules: ['payment_gateways', 'integrations', 'scheduler', 'gateway_autopay'],
}

export default integrationMeta
