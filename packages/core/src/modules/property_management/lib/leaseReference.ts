import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LeaseReferenceCounter } from '../data/entities'
import type { Scope } from './productUse'

export function formatLeaseReference(year: number, number: number): string {
  return `L-${year}-${String(number).padStart(3, '0')}`
}

export async function issueLeaseReference(em: EntityManager, scope: Scope, now: Date = new Date()): Promise<string> {
  const year = now.getFullYear()
  await em.getConnection().execute(
    `insert into property_management_lease_reference_counters (id, organization_id, tenant_id, year, last_number, created_at, updated_at)
     values (gen_random_uuid(), ?, ?, ?, 0, now(), now())
     on conflict (organization_id, tenant_id) do nothing`,
    [scope.organizationId, scope.tenantId, year],
    'run',
    em.getTransactionContext(),
  )
  const counter = await findOneWithDecryption(
    em,
    LeaseReferenceCounter,
    { ...scope },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    scope,
  )
  if (!counter) throw new Error('[internal] Lease reference counter missing')
  if (counter.year !== year) {
    counter.year = year
    counter.lastNumber = 0
  }
  counter.lastNumber += 1
  await em.flush()
  return formatLeaseReference(counter.year, counter.lastNumber)
}
