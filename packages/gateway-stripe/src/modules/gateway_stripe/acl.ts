export const features = [
  {
    id: 'gateway_stripe.view',
    title: 'View Stripe gateway configuration',
    module: 'gateway_stripe',
    dependsOn: ['payment_gateways.view'],
  },
  {
    id: 'gateway_stripe.configure',
    title: 'Configure Stripe gateway settings',
    module: 'gateway_stripe',
    dependsOn: ['gateway_stripe.view', 'payment_gateways.manage'],
  },
]

export default features
