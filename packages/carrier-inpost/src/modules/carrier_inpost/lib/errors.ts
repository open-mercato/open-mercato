// InPost ShipX API documentation:
// https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/18153476/API+ShipX+ENG+Documentation

const throwError = (message: string): never => {
  throw new Error(message);
}

export const inpostErrors = {
  missingApiToken: () => throwError('InPost API token is required'),
  missingOrganizationId: () => throwError('InPost organization ID is required'),
  apiError: (status: number, text: string) => throwError(`InPost API error ${status}: ${text}`),
  missingWebhookSignatureHeader: () => throwError('Missing X-Inpost-Signature header'),
  webhookSignatureMismatch: () => throwError('InPost webhook signature verification failed'),
  webhookInvalidJson: () => throwError('InPost webhook payload is not valid JSON'),
  missingTrackingIdentifier: () => throwError('trackingNumber or shipmentId is required for InPost tracking'),
  cancelNotAllowed: (status: string) =>
    throwError(`Shipment cannot be cancelled in its current status: ${status}`),
  cancelNotSupported: () =>
    throwError(
      'InPost does not support shipment cancellation via API. Cancel through the InPost merchant portal.',
    ),
  incompleteEnvPreset: () =>
    throwError(
      '[carrier_inpost] Incomplete InPost env preset. Set OM_INTEGRATION_INPOST_API_TOKEN and OM_INTEGRATION_INPOST_ORGANIZATION_ID.',
    ),
}
