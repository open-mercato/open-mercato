export const features = [
  {
    id: 'gateway_tpay.view',
    title: 'View Tpay gateway configuration',
    module: 'gateway_tpay',
    dependsOn: ['payment_gateways.view'],
  },
  {
    id: 'gateway_tpay.configure',
    title: 'Configure Tpay gateway settings',
    module: 'gateway_tpay',
    dependsOn: ['gateway_tpay.view', 'payment_gateways.manage'],
  },
]

export default features
