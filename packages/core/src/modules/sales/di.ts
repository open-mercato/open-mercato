import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
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
import { DefaultSalesCalculationService } from './services/salesCalculationService'
import { DefaultTaxCalculationService } from './services/taxCalculationService'
import { SalesDocumentNumberGenerator } from './services/salesDocumentNumberGenerator'
import {
  SalesOrder,
  SalesOrderLine,
  SalesOrderAdjustment,
  SalesQuote,
  SalesQuoteLine,
  SalesQuoteAdjustment,
  SalesChannel,
  SalesShipment,
  SalesShipmentItem,
  SalesInvoice,
  SalesInvoiceLine,
  SalesCreditMemo,
  SalesCreditMemoLine,
  SalesPayment,
  SalesPaymentAllocation,
  SalesReturn,
  SalesReturnLine,
  SalesNote,
  SalesDocumentAddress,
  SalesDocumentTag,
  SalesDocumentTagAssignment,
  SalesShippingMethod,
  SalesDeliveryWindow,
  SalesPaymentMethod,
  SalesTaxRate,
} from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  em: EntityManager
  eventBus?: EventBus | null
}

const RESOURCE_KIND_ORDER = 'sales.order'

const readSalesOrderUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId },
) => {
  const row = await em.findOne(
    SalesOrder,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
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
  if (includes(RESOURCE_KIND_ORDER)) readers[RESOURCE_KIND_ORDER] = readSalesOrderUpdatedAt
  return readers
}

export function register(container: AppContainer) {
  container.register({
    salesCalculationService: asFunction(({ eventBus }: AppCradle) => {
      return new DefaultSalesCalculationService(eventBus ?? null)
    })
      .singleton()
      .proxy(),
    taxCalculationService: asFunction(({ em, eventBus }: AppCradle) => {
      return new DefaultTaxCalculationService(em, eventBus ?? null)
    })
      .singleton()
      .proxy(),
    salesDocumentNumberGenerator: asFunction(({ em }: AppCradle) => {
      return new SalesDocumentNumberGenerator(em)
    })
      .singleton()
      .proxy(),
    SalesOrder: asValue(SalesOrder),
    SalesOrderLine: asValue(SalesOrderLine),
    SalesOrderAdjustment: asValue(SalesOrderAdjustment),
    SalesQuote: asValue(SalesQuote),
    SalesQuoteLine: asValue(SalesQuoteLine),
    SalesQuoteAdjustment: asValue(SalesQuoteAdjustment),
    SalesChannel: asValue(SalesChannel),
    SalesShipment: asValue(SalesShipment),
    SalesShipmentItem: asValue(SalesShipmentItem),
    SalesInvoice: asValue(SalesInvoice),
    SalesInvoiceLine: asValue(SalesInvoiceLine),
    SalesCreditMemo: asValue(SalesCreditMemo),
    SalesCreditMemoLine: asValue(SalesCreditMemoLine),
    SalesPayment: asValue(SalesPayment),
    SalesPaymentAllocation: asValue(SalesPaymentAllocation),
    SalesReturn: asValue(SalesReturn),
    SalesReturnLine: asValue(SalesReturnLine),
    SalesNote: asValue(SalesNote),
    SalesDocumentAddress: asValue(SalesDocumentAddress),
    SalesDocumentTag: asValue(SalesDocumentTag),
    SalesDocumentTagAssignment: asValue(SalesDocumentTagAssignment),
    SalesShippingMethod: asValue(SalesShippingMethod),
    SalesDeliveryWindow: asValue(SalesDeliveryWindow),
    SalesPaymentMethod: asValue(SalesPaymentMethod),
    SalesTaxRate: asValue(SalesTaxRate),
  })

  // OSS opt-in optimistic locking — see .ai/specs/2026-05-25-oss-optimistic-locking.md.
  // Contributes a sales.order reader to the shared store. Multiple modules
  // can register the same `crudMutationGuardService` Awilix key safely
  // because every binding points to the same store-backed factory.
  const enabledReaders = collectEnabledReaders()
  if (process.env.OM_OPTIMISTIC_LOCK_DEBUG === '1') {
    console.log('[optimistic-lock/sales] register()', {
      envRaw: process.env.OM_OPTIMISTIC_LOCK ?? null,
      enabledReaderKeys: Object.keys(enabledReaders),
    })
  }
  if (Object.keys(enabledReaders).length > 0) {
    registerOptimisticLockReaders(enabledReaders)
    container.register({
      crudMutationGuardService: asFunction(({ em }: AppCradle) => {
        if (process.env.OM_OPTIMISTIC_LOCK_DEBUG === '1') {
          console.log('[optimistic-lock/sales] factory invoked — service resolved', {
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
            console.log('[optimistic-lock/sales] validateMutation CALLED', {
              resourceKind: input.resourceKind,
              resourceId: input.resourceId,
              operation: input.operation,
              hasHeader: !!input.requestHeaders.get('x-om-ext-optimistic-lock-expected-updated-at'),
              headerValue: input.requestHeaders.get('x-om-ext-optimistic-lock-expected-updated-at'),
              allHeaderKeys: Array.from(input.requestHeaders.keys()),
            })
            const result = await original(input)
            console.log('[optimistic-lock/sales] validateMutation RETURNED', {
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
      console.log('[optimistic-lock/sales] registered crudMutationGuardService', {
        storeKeys: Object.keys(getAllOptimisticLockReaders()),
      })
    }
  }
}
