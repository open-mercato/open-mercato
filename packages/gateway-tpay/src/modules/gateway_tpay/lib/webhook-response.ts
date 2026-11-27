import type {
  WebhookHttpResponse,
  WebhookResponseOutcome,
} from '@open-mercato/shared/modules/payment_gateways/types'

const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8'

const OUTCOME_STATUS: Record<WebhookResponseOutcome, number> = {
  accepted: 200,
  no_candidate: 503,
  verification_unavailable: 503,
  processing_failed: 503,
  verification_failed: 400,
  payload_too_large: 413,
  rate_limited: 429,
}

export function formatTpayWebhookResponse(outcome: WebhookResponseOutcome): WebhookHttpResponse {
  return {
    status: OUTCOME_STATUS[outcome] ?? 503,
    body: outcome === 'accepted' ? 'TRUE' : 'FALSE',
    contentType: TEXT_CONTENT_TYPE,
  }
}
