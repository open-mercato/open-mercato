import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { PUSH_STATE_KEYS } from './push-state'

export function syncState(state: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state ?? {}).filter(([key]) =>
    !PUSH_STATE_KEYS.some((pushKey) => pushKey === key),
  ))
}

export function sameSyncState(previous: Record<string, unknown>, current: Record<string, unknown> | null | undefined): boolean {
  return serializeState(previous) === serializeState(syncState(current))
}

export async function withLockedChannel<Result>(
  em: EntityManager,
  channel: Pick<CommunicationChannel, 'id' | 'tenantId' | 'organizationId'>,
  update: (current: CommunicationChannel, transaction: EntityManager) => Promise<Result>,
): Promise<Result | undefined> {
  return em.fork({ clear: true }).transactional(async (transaction) => {
    const scope = { tenantId: channel.tenantId, organizationId: channel.organizationId ?? null }
    const current = await findOneWithDecryption(transaction, CommunicationChannel, {
      id: channel.id,
      ...scope,
      deletedAt: null,
    }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
    if (!current) return undefined
    return update(current, transaction)
  })
}

function serializeState(state: Record<string, unknown>): string {
  return JSON.stringify(state, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
    }
    return value
  })
}
