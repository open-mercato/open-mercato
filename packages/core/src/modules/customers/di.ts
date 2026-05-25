import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  createOptimisticLockGuardService,
  parseOptimisticLockEnv,
  type OptimisticLockCurrentReader,
} from '@open-mercato/shared/lib/crud/optimistic-lock'
import { OPTIMISTIC_LOCK_ENV_VAR } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  getAllOptimisticLockReaders,
  registerOptimisticLockReaders,
} from '@open-mercato/shared/lib/crud/optimistic-lock-store'
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

function collectEnabledReaders(): Record<string, OptimisticLockCurrentReader> {
  const config = parseOptimisticLockEnv(process.env[OPTIMISTIC_LOCK_ENV_VAR])
  if (config.mode === 'off') return {}
  const includes = (kind: string) =>
    config.mode === 'all' || config.entities.has(kind)
  const readers: Record<string, OptimisticLockCurrentReader> = {}
  if (includes(RESOURCE_KIND_COMPANY)) readers[RESOURCE_KIND_COMPANY] = readCustomerCompanyUpdatedAt
  // Register the person reader under both the canonical singular form and the
  // plural form the CRUD factory derives at runtime — whichever the env opts
  // in for, the reader is available.
  if (includes(RESOURCE_KIND_PERSON) || includes(RESOURCE_KIND_PEOPLE)) {
    readers[RESOURCE_KIND_PERSON] = readCustomerPersonUpdatedAt
    readers[RESOURCE_KIND_PEOPLE] = readCustomerPersonUpdatedAt
  }
  return readers
}

export function register(container: AppContainer) {
  container.register({
    CustomerEntity: asValue(CustomerEntity),
    CustomerAddress: asValue(CustomerAddress),
    CustomerInteraction: asValue(CustomerInteraction),
  })

  const enabledReaders = collectEnabledReaders()
  if (Object.keys(enabledReaders).length > 0) {
    registerOptimisticLockReaders(enabledReaders)
    container.register({
      crudMutationGuardService: asFunction(({ em }: { em: EntityManager }) =>
        createOptimisticLockGuardService({
          getEm: () => em,
          readers: getAllOptimisticLockReaders(),
        }),
      ).scoped(),
    })
  }
}
