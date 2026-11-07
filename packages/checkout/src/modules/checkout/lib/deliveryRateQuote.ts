import type { EntityManager } from '@mikro-orm/postgresql'
import { listShippingAdapters } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import type { ShippingRate } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  buildPackageLineInputs,
  lookupCartLinePeers,
  lookupCatalogProductWeightDimensions,
  lookupCatalogVariantWeightDimensions,
  resolveCartPackage,
  type CartLinePeerRow,
} from './cartLinesPeer'
import type { CarrierAddress } from './deliveryAddress'
import { lookupLinkFlatRateFallback } from './linkFlatRate'
import { lookupStoreFlatRateFallback, type StoreFlatRateFallback } from './storeSettingsPeer'
import { tryResolve } from './tryResolve'
import { lookupPrimaryWarehouseAddress } from './warehousePeer'

// Release 5, Step 2.13 (C13 "rate quoting inputs", D-R5-35 "flat-rate fallback location").

const logger = createLogger('checkout')

export type DeliveryOption = {
  deliveryMethodCode: string
  providerKey: string | null
  serviceCode: string | null
  label: string
  cost: string
  currencyCode: string
  estimatedDays: number | null
  source: 'carrier' | 'flat_rate'
}

export type DeliveryQuoteContainer = {
  resolve: <T = unknown>(name: string) => T
  hasRegistration?: (name: string) => boolean
}

export type DeliveryQuoteSessionInput = {
  id: string
  tenantId: string
  organizationId: string
  cartId: string | null
  storeId: string | null
  linkId: string | null
  channel: string
  currencyCode: string
}

/** §5.3's own flat-rate shape, carried onto a `DeliveryOption`. */
function toFlatRateOption(fallback: StoreFlatRateFallback): DeliveryOption {
  return {
    deliveryMethodCode: 'flat_rate',
    providerKey: null,
    serviceCode: null,
    label: 'checkout.delivery.flatRate',
    cost: fallback.amount.toFixed(2),
    currencyCode: fallback.currencyCode,
    estimatedDays: null,
    source: 'flat_rate',
  }
}

/** D-R5-35: storefront carts read the fallback from the store's own settings; link carts
 * read it from the link's own settings. API/agent/pos carts without a store or link have
 * no fallback source at all — `null`, same as a storefront cart whose store never
 * configured one. */
async function resolveFlatRateFallback(
  em: EntityManager,
  session: DeliveryQuoteSessionInput,
): Promise<StoreFlatRateFallback | null> {
  if (session.channel === 'pay_link' && session.linkId) {
    return lookupLinkFlatRateFallback(em, session.linkId, {
      tenantId: session.tenantId,
      organizationId: session.organizationId,
    })
  }
  if (session.storeId) {
    return lookupStoreFlatRateFallback(em, session.storeId, {
      tenantId: session.tenantId,
      organizationId: session.organizationId,
    })
  }
  return null
}

async function resolveOrigin(
  container: DeliveryQuoteContainer,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<CarrierAddress | null> {
  const wmsAvailable = tryResolve<unknown>(container, 'wmsReservationService')
  if (!wmsAvailable) return null
  const warehouse = await lookupPrimaryWarehouseAddress(em, scope)
  if (!warehouse?.country || !warehouse.postalCode || !warehouse.city || !warehouse.addressLine1) return null
  return {
    countryCode: warehouse.country,
    postalCode: warehouse.postalCode,
    city: warehouse.city,
    line1: warehouse.addressLine1,
  }
}

async function resolvePackages(
  em: EntityManager,
  session: DeliveryQuoteSessionInput,
): Promise<{ packages: ReturnType<typeof resolveCartPackage>[]; lines: CartLinePeerRow[] }> {
  if (!session.cartId) return { packages: [resolveCartPackage([])], lines: [] }
  const scope = { tenantId: session.tenantId, organizationId: session.organizationId }
  const lines = await lookupCartLinePeers(em, session.cartId, scope)
  const productIds = Array.from(new Set(lines.map((line) => line.productId)))
  const variantIds = Array.from(
    new Set(lines.map((line) => line.variantId).filter((id): id is string => !!id)),
  )
  const [productRows, variantRows] = await Promise.all([
    lookupCatalogProductWeightDimensions(em, productIds, scope),
    lookupCatalogVariantWeightDimensions(em, variantIds, scope),
  ])
  const lineInputs = buildPackageLineInputs(lines, productRows, variantRows)
  return { packages: [resolveCartPackage(lineInputs)], lines }
}

/**
 * The uncached compute step behind `GET .../delivery-options` — callers wrap this with
 * `lib/deliveryRateCache.ts#getOrComputeDeliveryOptions` for the §5.3 5-minute cache.
 * Throws `422 delivery_unavailable` (never a 500) when nothing — carrier or fallback —
 * can quote this cart.
 */
export async function computeDeliveryOptions(
  container: DeliveryQuoteContainer,
  em: EntityManager,
  session: DeliveryQuoteSessionInput,
  destination: CarrierAddress,
): Promise<DeliveryOption[]> {
  const scope = { tenantId: session.tenantId, organizationId: session.organizationId }
  const [{ packages }, origin] = await Promise.all([
    resolvePackages(em, session),
    resolveOrigin(container, em, scope),
  ])

  const carrierOptions: DeliveryOption[] = []
  const shippingCarrierService = origin ? tryResolve<{
    calculateRates: (input: {
      providerKey: string
      origin: CarrierAddress
      destination: CarrierAddress
      packages: Array<{ weightKg: number; lengthCm: number; widthCm: number; heightCm: number }>
      organizationId: string
      tenantId: string
    }) => Promise<ShippingRate[]>
  }>(container, 'shippingCarrierService') : undefined

  if (shippingCarrierService && origin) {
    const adapters = listShippingAdapters()
    for (const adapter of adapters) {
      try {
        const rates = await shippingCarrierService.calculateRates({
          providerKey: adapter.providerKey,
          origin,
          destination,
          packages,
          organizationId: session.organizationId,
          tenantId: session.tenantId,
        })
        for (const rate of rates) {
          carrierOptions.push({
            deliveryMethodCode: `${adapter.providerKey}:${rate.serviceCode}`,
            providerKey: adapter.providerKey,
            serviceCode: rate.serviceCode,
            label: rate.serviceName,
            cost: rate.amount.toFixed(2),
            currencyCode: rate.currencyCode,
            estimatedDays: rate.estimatedDays ?? null,
            source: 'carrier',
          })
        }
      } catch (err) {
        // R10: a single carrier's failure falls through to the flat-rate fallback below —
        // never a 500 for the whole request.
        logger.warn('[internal] shipping carrier rate quote failed, will consider the flat-rate fallback', {
          err,
          providerKey: adapter.providerKey,
          sessionId: session.id,
        })
      }
    }
  }

  if (carrierOptions.length > 0) return carrierOptions

  const fallback = await resolveFlatRateFallback(em, session)
  if (fallback) return [toFlatRateOption(fallback)]

  throw new CrudHttpError(422, {
    error: '[internal] no delivery rate is available for this address',
    code: 'delivery_unavailable',
  })
}
