import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { constantTimeEquals } from './constant-time-equals'

type MicrosoftWebhookEvent = Record<string, unknown>

export type MicrosoftWebhookChannelResolution = {
  channel: CommunicationChannel
  expectedClientState: string
  expectedSubscriptionId: string | null
}

export type MicrosoftWebhookValidation =
  | { ok: true; resolution: MicrosoftWebhookChannelResolution }
  | { ok: false; status: number; error: string }

export async function validateMicrosoftWebhookChannel(params: {
  em: EntityManager
  pathToken: string
  events: MicrosoftWebhookEvent[]
}): Promise<MicrosoftWebhookValidation> {
  const { em, pathToken, events } = params
  const subscriptionIds = collectSubscriptionIds(events)

  const channel = await resolveMicrosoftWebhookChannel(em, pathToken, subscriptionIds)
  if (!channel) {
    return { ok: false, status: 410, error: 'subscription_not_found' }
  }

  const reloaded = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: channel.id,
      tenantId: channel.tenantId,
      organizationId: channel.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    { tenantId: channel.tenantId, organizationId: channel.organizationId ?? null },
  )
  if (!reloaded) {
    return { ok: false, status: 410, error: 'subscription_not_found' }
  }

  const expectedClientState =
    (reloaded as { clientStateEncrypted?: string | null }).clientStateEncrypted ?? null
  if (!expectedClientState) {
    return { ok: false, status: 410, error: 'channel_missing_client_state' }
  }

  const expectedSubscriptionId =
    typeof (reloaded.channelState as { subscriptionId?: unknown } | null)?.subscriptionId === 'string'
      ? ((reloaded.channelState as { subscriptionId: string }).subscriptionId)
      : null

  for (const event of events) {
    const providedClientState = typeof event.clientState === 'string' ? event.clientState : ''
    if (!constantTimeEquals(providedClientState, expectedClientState)) {
      return { ok: false, status: 401, error: 'invalid_client_state' }
    }

    const providedSubscriptionId = typeof event.subscriptionId === 'string' ? event.subscriptionId : null
    if (expectedSubscriptionId && providedSubscriptionId && providedSubscriptionId !== expectedSubscriptionId) {
      return { ok: false, status: 401, error: 'invalid_subscription' }
    }
  }

  return {
    ok: true,
    resolution: { channel: reloaded, expectedClientState, expectedSubscriptionId },
  }
}

function collectSubscriptionIds(events: MicrosoftWebhookEvent[]): Set<string> {
  const out = new Set<string>()
  for (const event of events) {
    if (typeof event.subscriptionId === 'string' && event.subscriptionId.length > 0) {
      out.add(event.subscriptionId)
    }
  }
  return out
}

async function resolveMicrosoftWebhookChannel(
  em: EntityManager,
  pathToken: string,
  subscriptionIds: Set<string>,
): Promise<CommunicationChannel | null> {
  // Narrow to the subscription(s) named by THIS request instead of decrypting
  // every Microsoft channel in the system on each (unauthenticated) webhook — an
  // O(all-tenants) decrypt-all scan is a DoS amplifier and a tenant-scoping
  // smell. Match the URL path token + notification subscriptionIds against both
  // the channel id and the stored `channelState.subscriptionId`. The clientState
  // secret is compared later (constant-time) on the reloaded row, so resolution
  // here only needs to identify the candidate channel.
  const candidates = Array.from(new Set([pathToken, ...subscriptionIds])).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  if (candidates.length === 0) return null
  const candidateArray = `{${candidates
    .map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`
  const matches = await em.getConnection().execute<
    Array<{ id: string; tenant_id: string; organization_id: string | null }>
  >(
    `SELECT id, tenant_id, organization_id FROM communication_channels
       WHERE provider_key = 'microsoft' AND is_active = true AND deleted_at IS NULL
         AND (id::text = ANY(?::text[]) OR channel_state->>'subscriptionId' = ANY(?::text[]))
       LIMIT 1`,
    [candidateArray, candidateArray],
  )
  if (!Array.isArray(matches) || matches.length === 0) return null
  const match = matches[0]
  // Scope the decrypt to the resolved row's tenant/org (the raw SELECT above
  // surfaced them) so `findOneWithDecryption` never decrypts `clientStateEncrypted`
  // against a null tenant context, per the encryption helper contract.
  return findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: match.id,
      tenantId: match.tenant_id,
      organizationId: match.organization_id ?? null,
      providerKey: 'microsoft',
      isActive: true,
      deletedAt: null,
    },
    undefined,
    { tenantId: match.tenant_id, organizationId: match.organization_id ?? null },
  )
}
