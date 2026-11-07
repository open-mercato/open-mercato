import { createModuleQueue, type Queue } from '@open-mercato/queue'

// Password-reset and magic-link requests must respond identically whether the
// email matches an account or not — see customer_accounts/AGENTS.md and #8889.
// Lookup, token minting and email delivery all happen inside a queue worker so
// the HTTP response never carries account-dependent timing. The payload never
// carries a raw token: it is minted only inside the worker, after the job runs.
export const PASSWORD_RESET_DELIVERY_QUEUE = 'customer-accounts-password-reset-delivery'
export const MAGIC_LINK_DELIVERY_QUEUE = 'customer-accounts-magic-link-delivery'

export type AuthLinkDeliveryJobPayload = {
  email: string
  tenantId: string
}

const queues = new Map<string, Queue<AuthLinkDeliveryJobPayload>>()

function getQueue(name: string): Queue<AuthLinkDeliveryJobPayload> {
  const existing = queues.get(name)
  if (existing) return existing

  const created = createModuleQueue<AuthLinkDeliveryJobPayload>(name, { concurrency: 5 })
  queues.set(name, created)
  return created
}

export function getPasswordResetDeliveryQueue(): Queue<AuthLinkDeliveryJobPayload> {
  return getQueue(PASSWORD_RESET_DELIVERY_QUEUE)
}

export function getMagicLinkDeliveryQueue(): Queue<AuthLinkDeliveryJobPayload> {
  return getQueue(MAGIC_LINK_DELIVERY_QUEUE)
}
