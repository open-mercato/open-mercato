import type { IntegrationCredentialWebhookHelp } from '@open-mercato/shared/modules/integrations/types'

export const inpostWebhookSetupGuide: IntegrationCredentialWebhookHelp = {
  kind: 'webhook_setup',
  title: 'InPost webhook configuration',
  summary: 'Configure InPost to send tracking update webhooks so shipment statuses stay synchronized with Open Mercato.',
  endpointPath: '/api/shipping-carriers/webhook/inpost',
  dashboardPathLabel: 'InPost Manager -> API -> Webhooks',
  steps: [
    'Log in to InPost Manager and navigate to API -> Webhooks.',
    'Click "Add webhook" and set the destination URL to your public Open Mercato URL plus /api/shipping-carriers/webhook/inpost.',
    'Select the shipment status events you wish to receive.',
    'Copy the signing secret displayed by InPost and paste it into the Webhook Secret field in Integrations.',
    'Save the InPost integration credentials, then create a test shipment to verify delivery.',
  ],
  events: [
    'shipment.status_change',
  ],
  localDevelopment: {
    note: 'For local development, expose your app through a public HTTPS tunnel and use that public URL in InPost Manager.',
    tunnelCommand: 'ngrok http 3000',
    publicUrlExample: 'https://<your-subdomain>.ngrok-free.app/api/shipping-carriers/webhook/inpost',
  },
}
