import { asClass, asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { OptimisticLockCurrentReader } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { registerOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import {
  PurchaseBill,
  PurchaseOrder,
  PurchaseReceipt,
  PurchaseVendor,
  ReorderingRule,
  VendorPricelist,
} from './data/entities'
import { PurchaseCalculationService } from './services/purchaseCalculationService'
import { PurchaseDocumentNumberGenerator } from './services/purchaseDocumentNumberGenerator'
import { PurchaseOrderService } from './services/purchaseOrderService'
import { VendorPricelistService } from './services/vendorPricelistService'
import { PurchaseReceiptService } from './services/purchaseReceiptService'
import { ThreeWayMatchService } from './services/threeWayMatchService'
import { ReorderingEngine } from './services/reorderingEngine'

type AppCradle = AppContainer['cradle'] & {
  em: EntityManager
  eventBus?: EventBus | null
}

const RESOURCE_KIND_PURCHASE_ORDER = 'purchases.order'
const RESOURCE_KIND_PURCHASE_RECEIPT = 'purchases.receipt'
const RESOURCE_KIND_VENDOR_PRICELIST = 'purchases.pricelist'
const RESOURCE_KIND_PURCHASE_BILL = 'purchases.bill'
const RESOURCE_KIND_REORDERING_RULE = 'purchases.reordering_rule'
const RESOURCE_KIND_PURCHASE_VENDOR = 'purchases.vendor'

const readPurchasesOrderUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId }
) => {
  if (!resourceId) return null
  const row = await em.findOne(
    PurchaseOrder,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const }
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

const readPurchasesReceiptUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId }
) => {
  if (!resourceId) return null
  const row = await em.findOne(
    PurchaseReceipt,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const }
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

const readVendorPricelistUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId }
) => {
  if (!resourceId) return null
  const row = await em.findOne(
    VendorPricelist,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const }
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

const readPurchaseBillUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId }
) => {
  if (!resourceId) return null
  const row = await em.findOne(
    PurchaseBill,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const }
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

const readReorderingRuleUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId }
) => {
  if (!resourceId) return null
  const row = await em.findOne(
    ReorderingRule,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const }
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

const readPurchasesVendorUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId }
) => {
  if (!resourceId) return null
  const row = await em.findOne(
    PurchaseVendor,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const }
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

registerOptimisticLockReaders({
  [RESOURCE_KIND_PURCHASE_ORDER]: readPurchasesOrderUpdatedAt,
  [RESOURCE_KIND_PURCHASE_RECEIPT]: readPurchasesReceiptUpdatedAt,
  [RESOURCE_KIND_VENDOR_PRICELIST]: readVendorPricelistUpdatedAt,
  [RESOURCE_KIND_PURCHASE_BILL]: readPurchaseBillUpdatedAt,
  [RESOURCE_KIND_REORDERING_RULE]: readReorderingRuleUpdatedAt,
  [RESOURCE_KIND_PURCHASE_VENDOR]: readPurchasesVendorUpdatedAt,
})

export function register(container: AppContainer): void {
  container.register({
    purchaseCalculationService: asClass(PurchaseCalculationService)
      .singleton()
      .proxy(),
    purchaseDocumentNumberGenerator: asFunction(
      ({ em }: { em: EntityManager }) => new PurchaseDocumentNumberGenerator(em)
    )
      .scoped()
      .proxy(),
    purchaseOrderService: asFunction(
      ({
        em,
        purchaseCalculationService,
        purchaseDocumentNumberGenerator,
        eventBus,
        purchaseReceiptService,
      }: {
        em: EntityManager
        purchaseCalculationService: PurchaseCalculationService
        purchaseDocumentNumberGenerator: PurchaseDocumentNumberGenerator
        eventBus?: EventBus | null
        purchaseReceiptService: PurchaseReceiptService
      }) =>
        new PurchaseOrderService(
          em,
          purchaseCalculationService,
          purchaseDocumentNumberGenerator,
          eventBus,
          purchaseReceiptService
        )
    )
      .scoped()
      .proxy(),
    vendorPricelistService: asFunction(
      ({ em }: { em: EntityManager }) => new VendorPricelistService(em)
    )
      .scoped()
      .proxy(),
    purchaseReceiptService: asFunction(
      ({
        em,
        purchaseDocumentNumberGenerator,
        eventBus,
      }: {
        em: EntityManager
        purchaseDocumentNumberGenerator: PurchaseDocumentNumberGenerator
        eventBus?: EventBus | null
      }) => new PurchaseReceiptService(em, purchaseDocumentNumberGenerator, eventBus)
    )
      .scoped()
      .proxy(),
    threeWayMatchService: asFunction(
      ({ em, eventBus }: { em: EntityManager; eventBus?: EventBus | null }) =>
        new ThreeWayMatchService(em, eventBus)
    )
      .scoped()
      .proxy(),
    reorderingEngine: asFunction(
      ({
        em,
        purchaseDocumentNumberGenerator,
        vendorPricelistService,
        eventBus,
      }: {
        em: EntityManager
        purchaseDocumentNumberGenerator: PurchaseDocumentNumberGenerator
        vendorPricelistService: VendorPricelistService
        eventBus?: EventBus | null
      }) =>
        new ReorderingEngine(
          em,
          purchaseDocumentNumberGenerator,
          vendorPricelistService,
          eventBus
        )
    )
      .scoped()
      .proxy(),
  })
}
