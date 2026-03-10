import type { IntegrationCredentialWebhookHelp } from '@open-mercato/shared/modules/integrations/types'

export const stripeWebhookSetupGuide: IntegrationCredentialWebhookHelp = {
  kind: 'webhook_setup',
  title: 'Stripe webhook configuration',
  summary: 'Configure a Stripe webhook endpoint so payment status changes, refunds, failed payments, and disputes stay synchronized with Open Mercato.',
  endpointPath: '/api/payment_gateways/webhook/stripe',
  dashboardPathLabel: 'Stripe Dashboard -> Workbench -> Webhooks',
  steps: [
    'Create or open your Stripe webhook endpoint in Workbench.',
    'Set the destination URL to your public Open Mercato URL plus /api/payment_gateways/webhook/stripe.',
    'Subscribe to the payment and dispute events listed below.',
    'Reveal the endpoint signing secret and paste the whsec_... value into the Webhook Signing Secret field in Integrations.',
    'Save the Stripe integration credentials, then test the payment flow again.',
  ],
  events: [
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.canceled',
    'payment_intent.requires_action',
    'charge.refunded',
    'charge.refund.updated',
    'charge.dispute.created',
    'charge.dispute.closed',
  ],
  localDevelopment: {
    note: 'For local development, expose your app through a public HTTPS tunnel and use that public URL in Stripe.',
    tunnelCommand: 'ngrok http 3000',
    publicUrlExample: 'https://<your-subdomain>.ngrok-free.app/api/payment_gateways/webhook/stripe',
  },
}
