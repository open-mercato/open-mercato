export const features = [
  {
    id: 'gateway_autopay.view',
    title: 'View Autopay gateway configuration',
    module: 'gateway_autopay',
    dependsOn: ['payment_gateways.view'],
  },
  {
    id: 'gateway_autopay.configure',
    title: 'Configure Autopay gateway settings',
    module: 'gateway_autopay',
    dependsOn: ['gateway_autopay.view', 'payment_gateways.manage'],
  },
]

export default features
