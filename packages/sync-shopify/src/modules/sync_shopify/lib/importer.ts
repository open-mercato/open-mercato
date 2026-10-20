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
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import {
  buildOrderCommandInput,
  mapShopifyPaymentStatusValue,
  primaryVariant,
  productIsActive,
  sanitizeHandle,
  sanitizeSku,
  shopifyNumericId,
  shopifyOrderIsFullyPaid,
  splitPersonName,
  variantPriceAmount,
  type CatalogLink,
} from './map'
import { SHOPIFY_INTEGRATION_ID, type ShopifyCustomerNode, type ShopifyOrderNode, type ShopifyProductNode } from './types'

const PRODUCT_ENTITY = 'catalog_product'
const VARIANT_ENTITY = 'catalog_product_variant'
const PERSON_ENTITY = 'customer_person'
const ORDER_ENTITY = 'sales_order'
const PAYMENT_STATUS_DICTIONARY_KEY = 'sales.payment_status'

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
  const paymentStatusEntryCache = new Map<string, string | null>()

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

  async function resolvePaymentStatusEntryId(value: string): Promise<string | null> {
    const normalized = normalizeDictionaryValue(value)
    if (paymentStatusEntryCache.has(normalized)) return paymentStatusEntryCache.get(normalized) ?? null
    const dictionary = await em.findOne(Dictionary, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      key: PAYMENT_STATUS_DICTIONARY_KEY,
      deletedAt: null,
    })
    if (!dictionary) {
      paymentStatusEntryCache.set(normalized, null)
      return null
    }
    const entry = await em.findOne(DictionaryEntry, {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      normalizedValue: normalized,
    })
    const id = entry?.id ?? null
    paymentStatusEntryCache.set(normalized, id)
    return id
  }

  async function upsertPrice(variantId: string, productId: string, amount: number, currencyCode: string): Promise<void> {
    const kind = await resolvePriceKind()
    if (!kind || !/^[A-Z]{3}$/.test(currencyCode)) return
    const existing = await findOneWithDecryption(
      em,
      CatalogProductPrice,
      {
        variant: variantId,
        priceKind: kind.id,
        currencyCode,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      undefined,
      scope,
    )
    if (existing) {
      await commandBus.execute('catalog.prices.update', {
        input: {
          id: existing.id,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          unitPriceGross: amount,
        },
        ctx,
      })
      return
    }
    await commandBus.execute('catalog.prices.create', {
      input: {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        variantId,
        productId,
        priceKindId: kind.id,
        currencyCode,
        minQuantity: 1,
        unitPriceGross: amount,
      },
      ctx,
    })
  }

  async function recordPaidPayment(orderId: string, order: ShopifyOrderNode): Promise<void> {
    const amount = order.total ? Number(order.total.amount) : NaN
    if (!Number.isFinite(amount) || amount <= 0) return
    const currencyCode = order.currencyCode.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currencyCode)) return
    const statusEntryId = await resolvePaymentStatusEntryId('received')
    const placedAt = order.createdAt ? new Date(order.createdAt) : new Date()
    await commandBus.execute('sales.payments.create', {
      input: {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        orderId,
        amount,
        capturedAmount: amount,
        currencyCode,
        ...(statusEntryId ? { statusEntryId } : {}),
        receivedAt: placedAt,
        capturedAt: placedAt,
        paymentReference: order.name,
        metadata: {
          shopifyOrderId: order.id,
          shopifyFinancialStatus: order.displayFinancialStatus,
          source: SHOPIFY_INTEGRATION_ID,
        },
      },
      ctx,
    })
  }

  async function backfillOrderCustomer(
    orderId: string,
    customerEntityId: string,
  ): Promise<boolean> {
    await commandBus.execute('sales.orders.update', {
      input: {
        id: orderId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        customerEntityId,
      },
      ctx,
    })
    return true
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
        const productType = product.variants.length > 1 ? 'configurable' : 'simple'
        const handle = sanitizeHandle(
          product.handle || shopifyNumericId(product.id),
          `product-${shopifyNumericId(product.id)}`,
        )
        const unique = await uniqueHandle(em, scope, handle, existing?.id ?? null, product.id)
        const metadata = {
          ...(existing?.metadata ?? {}),
          shopifyProductId: product.id,
          shopifyVendor: product.vendor,
          shopifyProductType: product.productType,
          shopifyTags: product.tags,
        }
        const sharedInput = {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          title,
          description: product.descriptionHtml ?? undefined,
          handle: unique,
          sku: sanitizeSku(lead?.sku) ?? undefined,
          productType,
          isConfigurable: product.variants.length > 1,
          isActive: productIsActive(product.status),
          primaryCurrencyCode: /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : undefined,
          metadata,
        }

        let productId = existing?.id ?? null
        if (existing) {
          await commandBus.execute('catalog.products.update', {
            input: { ...sharedInput, id: existing.id },
            ctx,
          })
        } else {
          const { result } = await commandBus.execute('catalog.products.create', {
            input: sharedInput,
            ctx,
          })
          productId = readResultId(result, 'productId')
          if (!productId) throw new Error('Product command did not return an id.')
        }

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
          const variantInput = {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            productId: productId!,
            name: variant.title,
            sku: sanitizeSku(variant.sku) ?? undefined,
            barcode: variant.barcode ?? undefined,
            isDefault: index === 0,
            isActive: productIsActive(product.status),
            metadata: {
              ...(existingVariant?.metadata ?? {}),
              shopifyVariantId: variant.id,
              shopifyOptions: variant.selectedOptions,
              shopifyCompareAtPrice: variant.compareAtPrice,
            },
          }
          let variantId: string
          if (existingVariant) {
            await commandBus.execute('catalog.variants.update', {
              input: { ...variantInput, id: existingVariant.id },
              ctx,
            })
            variantId = existingVariant.id
          } else {
            const { result } = await commandBus.execute('catalog.variants.create', {
              input: variantInput,
              ctx,
            })
            const createdVariantId = readResultId(result, 'variantId')
            if (!createdVariantId) throw new Error('Variant command did not return an id.')
            variantId = createdVariantId
          }
          await mapping.storeExternalIdMapping(SHOPIFY_INTEGRATION_ID, VARIANT_ENTITY, variantId, variant.id, scope)
          const amount = variantPriceAmount(variant)
          if (amount !== null) await upsertPrice(variantId, productId!, amount, currencyCode)
        }

        await mapping.storeExternalIdMapping(SHOPIFY_INTEGRATION_ID, PRODUCT_ENTITY, productId!, product.id, scope)
        return {
          externalId: product.id,
          action,
          data: { localId: productId, title, variantCount: product.variants.length },
        }
      } catch (error) {
        return failedItem(product.id, error)
      }
    },

    async upsertCustomer(customer) {
      try {
        const name = splitPersonName(customer)
        const localId = await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, PERSON_ENTITY, customer.id, scope)
        // Ignore soft-deleted persons so a deleted CRM row can be recreated (#7397).
        const existing = localId
          ? await findOneWithDecryption(em, CustomerEntity, {
              id: localId,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              deletedAt: null,
            }, undefined, scope)
          : null
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
        const commandId = existing ? 'customers.people.update' : 'customers.people.create'
        const { result } = await commandBus.execute(commandId, {
          input: existing ? { ...input, id: existing.id } : input,
          ctx,
        })
        const entityId = existing?.id ?? readResultId(result, 'entityId')
        if (!entityId) throw new Error('Customer command did not return an id.')
        await mapping.storeExternalIdMapping(SHOPIFY_INTEGRATION_ID, PERSON_ENTITY, entityId, customer.id, scope)
        return {
          externalId: customer.id,
          action: existing ? 'update' : 'create',
          data: { localId: entityId, email: customer.email },
        }
      } catch (error) {
        return failedItem(customer.id, error)
      }
    },

    async upsertOrder(order) {
      try {
        const existingId = await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, ORDER_ENTITY, order.id, scope)
        const existingOrder = existingId
          ? await findOneWithDecryption(em, SalesOrder, {
              id: existingId,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              deletedAt: null,
            }, undefined, scope)
          : null

        if (existingOrder) {
          // Backfill customer when missing, or when the linked person was deleted (#7398 / #7397).
          if (order.customerId) {
            const linkedPerson = existingOrder.customerEntityId
              ? await findOneWithDecryption(em, CustomerEntity, {
                  id: existingOrder.customerEntityId,
                  tenantId: scope.tenantId,
                  organizationId: scope.organizationId,
                  deletedAt: null,
                }, undefined, scope)
              : null
            if (!linkedPerson) {
              const customerEntityId = await mapping.lookupLocalId(
                SHOPIFY_INTEGRATION_ID,
                PERSON_ENTITY,
                order.customerId,
                scope,
              )
              if (customerEntityId) {
                const person = await findOneWithDecryption(em, CustomerEntity, {
                  id: customerEntityId,
                  tenantId: scope.tenantId,
                  organizationId: scope.organizationId,
                  deletedAt: null,
                }, undefined, scope)
                if (person && person.id !== existingOrder.customerEntityId) {
                  await backfillOrderCustomer(existingOrder.id, customerEntityId)
                  return {
                    externalId: order.id,
                    action: 'update',
                    data: { localId: existingOrder.id, reason: 'customer_backfill' },
                  }
                }
              }
            }
          }
          return {
            externalId: order.id,
            action: 'skip',
            data: { localId: existingOrder.id, reason: 'already_imported' },
          }
        }

        const customerEntityId = order.customerId
          ? await mapping.lookupLocalId(SHOPIFY_INTEGRATION_ID, PERSON_ENTITY, order.customerId, scope)
          : null
        const liveCustomerId = customerEntityId
          ? await findOneWithDecryption(em, CustomerEntity, {
              id: customerEntityId,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              deletedAt: null,
            }, undefined, scope).then((row) => row?.id ?? null)
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

        const paymentStatusValue = mapShopifyPaymentStatusValue(order.displayFinancialStatus)
        const paymentStatusEntryId = paymentStatusValue
          ? await resolvePaymentStatusEntryId(paymentStatusValue)
          : null

        const { result } = await commandBus.execute('sales.orders.create', {
          input: buildOrderCommandInput({
            scope,
            order,
            customerEntityId: liveCustomerId,
            catalogByVariantId,
            paymentStatusEntryId,
          }),
          ctx,
        })
        const orderId = readResultId(result, 'orderId')
        if (!orderId) throw new Error('Order command did not return an id.')
        await mapping.storeExternalIdMapping(SHOPIFY_INTEGRATION_ID, ORDER_ENTITY, orderId, order.id, scope)

        if (shopifyOrderIsFullyPaid(order.displayFinancialStatus)) {
          try {
            await recordPaidPayment(orderId, order)
          } catch (paymentError) {
            // Order is already mapped; surface payment failure without failing the import item.
            return {
              externalId: order.id,
              action: 'create',
              data: {
                localId: orderId,
                name: order.name,
                lineCount: order.lines.length,
                shopifyTotal: order.total,
                paymentWarning: paymentError instanceof Error ? paymentError.message : 'payment_failed',
              },
            }
          }
        }

        return {
          externalId: order.id,
          action: 'create',
          data: {
            localId: orderId,
            name: order.name,
            lineCount: order.lines.length,
            shopifyTotal: order.total,
          },
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
  currentId: string | null,
  externalId: string,
): Promise<string> {
  const taken = await findOneWithDecryption(em, CatalogProduct, {
    handle,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }, undefined, scope)
  if (!taken || taken.id === currentId) return handle
  return sanitizeHandle(`${handle}-${shopifyNumericId(externalId)}`, `product-${shopifyNumericId(externalId)}`)
}
