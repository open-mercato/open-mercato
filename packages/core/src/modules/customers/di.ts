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
const RESOURCE_KIND_PERSON = 'customers.person'

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
  if (includes(RESOURCE_KIND_PERSON)) readers[RESOURCE_KIND_PERSON] = readCustomerPersonUpdatedAt
  return readers
}

export function register(container: AppContainer) {
  container.register({
    CustomerEntity: asValue(CustomerEntity),
    CustomerAddress: asValue(CustomerAddress),
    CustomerInteraction: asValue(CustomerInteraction),
  })

  const enabledReaders = collectEnabledReaders()
  if (process.env.OM_OPTIMISTIC_LOCK_DEBUG === '1') {
    console.log('[optimistic-lock/customers] register()', {
      envVar: OPTIMISTIC_LOCK_ENV_VAR,
      envRaw: process.env[OPTIMISTIC_LOCK_ENV_VAR] ?? null,
      envFromLiteralKey: process.env.OM_OPTIMISTIC_LOCK ?? null,
      enabledReaderKeys: Object.keys(enabledReaders),
    })
  }
  if (Object.keys(enabledReaders).length > 0) {
    registerOptimisticLockReaders(enabledReaders)
    container.register({
      crudMutationGuardService: asFunction(({ em }: { em: EntityManager }) => {
        if (process.env.OM_OPTIMISTIC_LOCK_DEBUG === '1') {
          console.log('[optimistic-lock/customers] factory invoked — service resolved', {
            storeKeysAtResolve: Object.keys(getAllOptimisticLockReaders()),
          })
        }
        const svc = createOptimisticLockGuardService({
          getEm: () => em,
          readers: getAllOptimisticLockReaders(),
        })
        if (process.env.OM_OPTIMISTIC_LOCK_DEBUG === '1') {
          const original = svc.validateMutation.bind(svc)
          svc.validateMutation = async (input) => {
            console.log('[optimistic-lock/customers] validateMutation CALLED', {
              resourceKind: input.resourceKind,
              resourceId: input.resourceId,
              operation: input.operation,
              hasHeader: !!input.requestHeaders.get('x-om-ext-optimistic-lock-expected-updated-at'),
              headerValue: input.requestHeaders.get('x-om-ext-optimistic-lock-expected-updated-at'),
              allHeaderKeys: Array.from(input.requestHeaders.keys()),
            })
            const result = await original(input)
            console.log('[optimistic-lock/customers] validateMutation RETURNED', {
              ok: result.ok,
              ...(result.ok ? {} : { status: result.status, body: result.body }),
            })
            return result
          }
        }
        return svc
      }).scoped(),
    })
    if (process.env.OM_OPTIMISTIC_LOCK_DEBUG === '1') {
      console.log('[optimistic-lock/customers] registered crudMutationGuardService', {
        storeKeys: Object.keys(getAllOptimisticLockReaders()),
      })
    }
  }
}
