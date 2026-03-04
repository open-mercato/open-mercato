export const features = {
  'payment_gateways.view': {
    name: 'View payment gateway integrations',
    description: 'Allows users to view gateway status, sessions, and transaction metadata.',
    module: 'payment_gateways',
  },
  'payment_gateways.manage': {
    name: 'Manage payment gateway integrations',
    description: 'Allows users to configure providers and create/capture/refund/cancel sessions.',
    module: 'payment_gateways',
  },
} as const

export default features
