export const inpostErrors = {
  missingApiToken: () => new Error('InPost API token is required'),
  missingOrganizationId: () => new Error('InPost organization ID is required'),
  apiError: (status: number, text: string) => new Error(`InPost API error ${status}: ${text}`),
  missingWebhookSignatureHeader: () => new Error('Missing X-Inpost-Signature header'),
  webhookSignatureMismatch: () => new Error('InPost webhook signature verification failed'),
  webhookInvalidJson: () => new Error('InPost webhook payload is not valid JSON'),
  missingTrackingIdentifier: () => new Error('trackingNumber or shipmentId is required for InPost tracking'),
  incompleteEnvPreset: () =>
    new Error(
      '[carrier_inpost] Incomplete InPost env preset. Set OM_INTEGRATION_INPOST_API_TOKEN and OM_INTEGRATION_INPOST_ORGANIZATION_ID.',
    ),
}
