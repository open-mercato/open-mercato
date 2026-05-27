import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { OptimisticLockCurrentReader } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { registerOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { CustomerEntity, CustomerAddress, CustomerInteraction } from './data/entities'

const RESOURCE_KIND_COMPANY = 'customers.company'
// The CRUD factory derives resourceKind via singularize-the-second-segment of
// the commandId. For `customers.companies.update` it produces 'customers.company'.
// For `customers.people.update` it does NOT singularize 'people' → 'person' (the
// irregular plural is preserved), so the runtime resourceKind is
// 'customers.people'. We register the reader under BOTH names so the
// env opt-in entry can use either form (`customers.person` per spec or
// `customers.people` matching the factory's derivation).
const RESOURCE_KIND_PERSON = 'customers.person'
const RESOURCE_KIND_PEOPLE = 'customers.people'

const readCustomerCompanyUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId },
) => {
  const row = await em.findOne(
    CustomerEntity,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      kind: 'company',
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const },
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

const readCustomerPersonUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId },
) => {
  const row = await em.findOne(
    CustomerEntity,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      kind: 'person',
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const },
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

// Hand-wired readers must register at module-load time so they LAND BEFORE
// the factory's `registerOptimisticLockReaderIfAbsent` calls in
// `makeCrudRoute`. The discriminator (`kind: 'company' | 'person'`) cannot
// be expressed by the generic auto-reader because both kinds share the
// `customer_entities` polymorphic table. Registered unconditionally — the
// guard's mode check short-circuits when `OM_OPTIMISTIC_LOCK=off`.
registerOptimisticLockReaders({
  [RESOURCE_KIND_COMPANY]: readCustomerCompanyUpdatedAt,
  [RESOURCE_KIND_PERSON]: readCustomerPersonUpdatedAt,
  [RESOURCE_KIND_PEOPLE]: readCustomerPersonUpdatedAt,
})

export function register(container: AppContainer) {
  container.register({
    CustomerEntity: asValue(CustomerEntity),
    CustomerAddress: asValue(CustomerAddress),
    CustomerInteraction: asValue(CustomerInteraction),
  })
  // `crudMutationGuardService` is registered platform-wide in the shared
  // DI bootstrap (`packages/shared/src/lib/di/container.ts`). It already
  // resolves the hand-wired readers above from the global store, so this
  // module no longer needs its own DI binding.
}
