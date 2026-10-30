import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'

const logger = createLogger('communication_channels')

export type EnsureSystemEmailChannelInput = {
  tenantId: string
  organizationId: string
  providerKey: string
  externalIdentifier: string
  displayName?: string
  capabilities?: Record<string, unknown>
}

export type EnsureSystemEmailChannelResult = 'created' | 'updated' | 'failed'

/**
 * Idempotently create or refresh a tenant's system email channel row.
 *
 * Shared by the two places that need the same row: the provider env preset, which runs at tenant setup
 * and again on every `yarn mercato seed:defaults --module channel_<provider>` used to migrate tenants
 * that predate the Communications Hub, and the lazy repair in `sendSystemEmail` for a tenant whose
 * credentials were saved through the integrations admin UI (which stores credentials but has no hook
 * to create the channel).
 *
 * Never throws: a channel row is a convenience for the Hub UI and for later lookups, so a failure to
 * write one must not take down the caller — an email send in particular still has usable credentials.
 */
export async function ensureSystemEmailChannel(
  em: EntityManager,
  input: EnsureSystemEmailChannelInput,
): Promise<EnsureSystemEmailChannelResult> {
  const { tenantId, organizationId, providerKey, externalIdentifier } = input
  const displayName = input.displayName ?? `${providerKey} system email`
  const dscope = { tenantId, organizationId }

  try {
    const existing = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        providerKey,
        channelType: 'email',
        tenantId,
        organizationId,
        userId: null,
        deletedAt: null,
      },
      undefined,
      dscope,
    )

    if (existing) {
      existing.displayName = displayName
      existing.externalIdentifier = externalIdentifier
      if (input.capabilities) existing.capabilities = { ...input.capabilities }
      existing.isActive = true
      existing.status = 'connected'
      existing.lastError = null
      await em.flush()
      return 'updated'
    }

    const channel = em.create(CommunicationChannel, {
      providerKey,
      channelType: 'email',
      displayName,
      externalIdentifier,
      capabilities: { ...(input.capabilities ?? {}) },
      isActive: true,
      status: 'connected',
      userId: null,
      pollIntervalSeconds: null,
      tenantId,
      organizationId,
    })
    await em.persist(channel).flush()
    return 'created'
  } catch (err) {
    logger.warn('Could not ensure system email channel', { err, tenantId, providerKey })
    return 'failed'
  }
}
