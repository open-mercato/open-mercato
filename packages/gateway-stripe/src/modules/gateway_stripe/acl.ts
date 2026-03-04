export const features = {
  'gateway_stripe.view': {
    name: 'View Stripe gateway',
    description: 'Allows users to view Stripe checkout configuration and payment status.',
    module: 'gateway_stripe',
  },
  'gateway_stripe.configure': {
    name: 'Configure Stripe gateway',
    description: 'Allows users to configure Stripe keys and gateway-specific settings.',
    module: 'gateway_stripe',
  },
  'gateway_stripe.checkout': {
    name: 'Run Stripe checkout',
    description: 'Allows users to create Stripe Checkout sessions for orders and demo flows.',
    module: 'gateway_stripe',
  },
} as const

export default features
