export const stripeContentSecurityPolicy = {
  scriptOrigins: ['https://js.stripe.com', 'https://*.js.stripe.com'],
  connectOrigins: ['https://api.stripe.com', 'https://link.com', 'https://*.link.com'],
  frameOrigins: ['https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com', 'https://link.com', 'https://*.link.com'],
} as const
