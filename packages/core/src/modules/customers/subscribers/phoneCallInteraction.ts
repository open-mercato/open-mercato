import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity, CustomerInteraction } from '../data/entities'
import { findPeopleByAddresses } from '../lib/findPeopleByAddresses'
import {
  buildPhoneCallInteraction,
  normalizePhoneDigits,
  type PhoneCallCompletedPayload,
} from '../lib/phoneCallInteractions'
import { emitCustomersEvent } from '../events'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

export const metadata = {
  event: 'phone_calls.call.completed',
  persistent: true,
  id: 'customers:phone-call-interaction',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handlePhoneCallCompleted(
  payload: PhoneCallCompletedPayload | null | undefined,
  ctx: SubscriberContext,
): Promise<void> {
  if (!payload || typeof payload.id !== 'string') return
  if (typeof payload.tenantId !== 'string' || !payload.tenantId) return
  if (typeof payload.organizationId !== 'string' || !payload.organizationId) return

  const { tenantId, organizationId } = payload
  const scope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()

  const call = (await findOneWithDecryption(
    em,
    'PhoneCall' as any,
    { id: payload.id, tenantId, organizationId } as any,
    undefined,
    scope,
  )) as { id: string; deletedAt?: Date | null } | null
  if (!call || call.deletedAt) return

  const emails = (payload.participants ?? [])
    .map((participant) => participant.email)
    .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
  const phones = new Set(
    (payload.participants ?? [])
      .map((participant) => normalizePhoneDigits(participant.phoneNumber))
      .filter((phone): phone is string => Boolean(phone)),
  )

  const personIds = new Set<string>()
  if (emails.length) {
    const matches = await findPeopleByAddresses(em, emails, tenantId, organizationId)
    matches.forEach((match) => personIds.add(match.id))
  }
  if (phones.size) {
    const candidates = (await findWithDecryption(
      em,
      CustomerEntity,
      { tenantId, organizationId, kind: 'person', deletedAt: null } as any,
      { limit: 500 },
      scope,
    )) as Array<{ id: string; primaryPhone?: string | null }>
    for (const candidate of candidates) {
      const digits = normalizePhoneDigits(candidate.primaryPhone)
      if (digits && phones.has(digits)) personIds.add(candidate.id)
    }
  }

  if (personIds.size === 0) return

  let created = 0
  const createdIds: string[] = []
  for (const personId of personIds) {
    const draft = buildPhoneCallInteraction({ call: payload, personId })
    const existing = await findOneWithDecryption(
      em,
      CustomerInteraction,
      { entity: personId, externalMessageId: draft.externalMessageId, deletedAt: null } as any,
      undefined,
      scope,
    )
    if (existing) continue
    const interaction = em.create(CustomerInteraction, {
      organizationId,
      tenantId,
      entity: em.getReference(CustomerEntity, personId),
      interactionType: draft.interactionType,
      title: draft.title,
      body: draft.body,
      status: draft.status,
      occurredAt: draft.occurredAt,
      durationMinutes: draft.durationMinutes ?? undefined,
      source: draft.source,
      channelProviderKey: draft.channelProviderKey ?? undefined,
      externalMessageId: draft.externalMessageId,
      authorUserId: draft.authorUserId ?? undefined,
      participants: draft.participants,
    })
    em.persist(interaction)
    createdIds.push(interaction.id)
    created += 1
  }

  if (created === 0) return
  await em.flush()
  for (const id of createdIds) {
    await emitCustomersEvent('customers.interaction.created', {
      id,
      tenantId,
      organizationId,
    }).catch((error) => {
      logger.warn('Phone call interaction event emit failed', { err: error })
    })
  }
}
