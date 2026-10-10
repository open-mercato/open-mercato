import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantScope } from '@open-mercato/core/modules/data_sync/lib/adapter'
import type { ExternalIdMappingService } from '@open-mercato/core/modules/data_sync/lib/id-mapping'
import {
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { buildOrderCommandInput, primaryVariant, productIsActive, shopifyNumericId, splitPersonName, variantPriceAmount, type CatalogLink } from './map'
import { SHOPIFY_INTEGRATION_ID, type ShopifyCustomerNode, type ShopifyOrderNode, type ShopifyProductNode } from './types'

const PRODUCT_ENTITY = 'catalog_product'
const VARIANT_ENTITY = 'catalog_product_variant'
const PERSON_ENTITY = 'customer_person'
const ORDER_ENTITY = 'sales_order'

type CommandExecutor = {
  execute(id: string, options: { input: Record<string, unknown>; ctx: CommandRuntimeContext }): Promise<{ result: unknown }>
}

export type ShopifyImporter = {
  upsertProduct(product: ShopifyProductNode, currencyCode: string): Promise<ImportItem>
  upsertCustomer(customer: ShopifyCustomerNode): Promise<ImportItem>
  upsertOrder(order: ShopifyOrderNode): Promise<ImportItem>
}

function failedItem(externalId: string, error: unknown): ImportItem {
  const errorMessage = error instanceof Error ? error.message : 'Shopify import failed'
  return {
    externalId,
    action: 'failed',
    data: { errorMessage, errorCode: 'sync_shopify.item_failed' },
  }
}

function commandContext(container: CommandRuntimeContext['container'], scope: TenantScope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
    syncOrigin: SHOPIFY_INTEGRATION_ID,
    bulkImport: { skipNotifications: true },
  }
}

function readResultId(result: unknown, key: string): string | null {
  if (!result || typeof result !== 'object') return null
  const value = (result as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export async function createShopifyImporter(scope: TenantScope): Promise<ShopifyImporter> {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const mapping = container.resolve('externalIdMappingService') as ExternalIdMappingService
  const commandBus = container.resolve('commandBus') as CommandExecutor
  const ctx = commandContext(container, scope)
  let priceKind: CatalogPriceKind | null | undefined

  async function resolvePriceKind(): Promise<CatalogPriceKind | null> {
    if (priceKind !== undefined) return priceKind
    const kinds = await findWithDecryption(
      em,
      CatalogPriceKind,
      { tenantId: scope.tenantId, deletedAt: null, isActive: true, isPromotion: false },
      undefined,
      scope,
    )
    priceKind = kinds.find((kind) => kind.code === 'regular' || kind.code === 'base') ?? kinds[0] ?? null
    return priceKind
  }

  async function upsertPrice(variant: CatalogProductVariant, product: CatalogProduct, amount: number, currencyCode: string): Promise<void> {
    const kind = await resolvePriceKind()
    if (!kind || !/^[A-Z]{3}$/.test(currencyCode)) return
    const existing = await findOneWithDecryption(
      em,
      CatalogProductPrice,
      {
        variant: variant.id,
        priceKind: kind.id,
        currencyCode,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      undefined,
      scope,
    )
    const value = amount.toFixed(4)
    if (existing) {
      existing.unitPriceGross = value
      existing.unitPriceNet = value
      return
    }
    em.create(CatalogProductPrice, {
      variant,
      product,
      priceKind: kind,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      currencyCode,
      kind: 'regular',
      minQuantity: 1,
      unitPriceGross: value,
      unitPriceNet: value,
    })
  }

  return {
    async upsertProduct(product, currencyCode) {
      try {
        const localId = await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, PRODUCT_ENTITY, product.id, scope)
        const existing = localId
          ? await findOneWithDecryption(em, CatalogProduct, {
              id: localId,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              deletedAt: null,
            }, undefined, scope)
          : null
        const lead = primaryVariant(product)
        const title = product.title.trim() || 'Untitled product'
        const action = existing ? 'update' as const : 'create' as const
        const record = existing ?? em.create(CatalogProduct, {
          id: randomUUID(),
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          title,
          productType: product.variants.length > 1 ? 'configurable' : 'simple',
          isConfigurable: product.variants.length > 1,
          isActive: productIsActive(product.status),
        })
        record.title = title
        record.description = product.descriptionHtml
        record.handle = await uniqueHandle(em, scope, product.handle || shopifyNumericId(product.id), record.id, product.id)
        record.sku = lead?.sku ?? null
        record.productType = product.variants.length > 1 ? 'configurable' : 'simple'
        record.isActive = productIsActive(product.status)
        record.primaryCurrencyCode = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : null
        record.metadata = {
          ...(record.metadata ?? {}),
          shopifyProductId: product.id,
          shopifyVendor: product.vendor,
          shopifyProductType: product.productType,
          shopifyTags: product.tags,
        }
        await em.flush()
        await mapping.storeExternalIdMapping(SHOPIFY_INTEGRATION_ID, PRODUCT_ENTITY, record.id, product.id, scope)

        for (const [index, variant] of product.variants.entries()) {
          const variantLocalId = await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, VARIANT_ENTITY, variant.id, scope)
          const existingVariant = variantLocalId
            ? await findOneWithDecryption(em, CatalogProductVariant, {
                id: variantLocalId,
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                deletedAt: null,
              }, undefined, scope)
            : null
          const row = existingVariant ?? em.create(CatalogProductVariant, {
            id: randomUUID(),
            product: record,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            isDefault: index === 0,
            isActive: productIsActive(product.status),
          })
          row.product = record
          row.name = variant.title
          row.sku = variant.sku
          row.barcode = variant.barcode
          row.isDefault = index === 0
          row.isActive = record.isActive
          row.metadata = {
            ...(row.metadata ?? {}),
            shopifyVariantId: variant.id,
            shopifyOptions: variant.selectedOptions,
            shopifyCompareAtPrice: variant.compareAtPrice,
          }
          await em.flush()
          await mapping.storeExternalIdMapping(SHOPIFY_INTEGRATION_ID, VARIANT_ENTITY, row.id, variant.id, scope)
          const amount = variantPriceAmount(variant)
          if (amount !== null) await upsertPrice(row, record, amount, currencyCode)
        }
        await em.flush()
        return {
          externalId: product.id,
          action,
          data: { localId: record.id, title: record.title, variantCount: product.variants.length },
        }
      } catch (error) {
        return failedItem(product.id, error)
      }
    },

    async upsertCustomer(customer) {
      try {
        const name = splitPersonName(customer)
        const localId = await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, PERSON_ENTITY, customer.id, scope)
        const input = {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          firstName: name.firstName,
          lastName: name.lastName,
          displayName: name.displayName,
          primaryEmail: customer.email ?? undefined,
          primaryPhone: customer.phone ?? undefined,
          source: 'shopify',
          isActive: true,
        }
        const commandId = localId ? 'customers.people.update' : 'customers.people.create'
        const { result } = await commandBus.execute(commandId, {
          input: localId ? { ...input, id: localId } : input,
          ctx,
        })
        const entityId = localId ?? readResultId(result, 'entityId')
        if (!entityId) throw new Error('Customer command did not return an id.')
        await mapping.storeExternalIdMapping(SHOPIFY_INTEGRATION_ID, PERSON_ENTITY, entityId, customer.id, scope)
        return {
          externalId: customer.id,
          action: localId ? 'update' : 'create',
          data: { localId: entityId, email: customer.email },
        }
      } catch (error) {
        return failedItem(customer.id, error)
      }
    },

    async upsertOrder(order) {
      try {
        const existingId = await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, ORDER_ENTITY, order.id, scope)
        if (existingId) {
          return {
            externalId: order.id,
            action: 'skip',
            data: { localId: existingId, reason: 'already_imported' },
          }
        }
        const customerEntityId = order.customerId
          ? await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, PERSON_ENTITY, order.customerId, scope)
          : null
        const catalogByVariantId = new Map<string, CatalogLink>()
        for (const line of order.lines) {
          if (!line.variantId || catalogByVariantId.has(line.variantId)) continue
          const variantId = await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, VARIANT_ENTITY, line.variantId, scope)
          if (!variantId) continue
          const variant = await findOneWithDecryption(em, CatalogProductVariant, {
            id: variantId,
            tenantId: scope.tenantId,
            deletedAt: null,
          }, { populate: ['product'] }, scope)
          const productId = variant?.product?.id
          if (productId) catalogByVariantId.set(line.variantId, { productId, variantId })
        }
        const { result } = await commandBus.execute('sales.orders.create', {
          input: buildOrderCommandInput({
            scope,
            order,
            customerEntityId,
            catalogByVariantId,
          }),
          ctx,
        })
        const orderId = readResultId(result, 'orderId')
        if (!orderId) throw new Error('Order command did not return an id.')
        await mapping.storeExternalIdMapping(SHOPIFY_INTEGRATION_ID, ORDER_ENTITY, orderId, order.id, scope)
        return {
          externalId: order.id,
          action: 'create',
          data: { localId: orderId, name: order.name },
        }
      } catch (error) {
        return failedItem(order.id, error)
      }
    },
  }
}

async function uniqueHandle(
  em: EntityManager,
  scope: TenantScope,
  handle: string,
  currentId: string,
  externalId: string,
): Promise<string> {
  const base = handle.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'product'
  const taken = await findOneWithDecryption(em, CatalogProduct, {
    handle: base,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }, undefined, scope)
  if (!taken || taken.id === currentId) return base
  return `${base}-${shopifyNumericId(externalId)}`.slice(0, 191)
}
