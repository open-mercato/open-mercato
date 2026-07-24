import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaimRegistration } from '../data/entities'
import { addWarrantyMonths, computeWarrantyEntitlementPreview } from '../lib/warrantyPreview'
import { resolveEffectiveWarrantyClaimSettings } from '../lib/settings'

export interface WarrantyEntitlementInput {
  serialNumber?: string | null
  orderId?: string | null
  productId?: string | null
  variantId?: string | null
  sku?: string | null
  purchaseDate?: string | null
}

export interface WarrantyEntitlementResult {
  warrantyStatus: 'in_warranty' | 'out_of_warranty' | 'unknown'
  coverageType: 'standard' | 'extended' | 'none' | null
  expiresAt: string | null
  source: 'registration' | 'order' | 'manual' | 'resolver' | null
}

export interface WarrantyEntitlementResolver {
  resolveEntitlement(
    input: WarrantyEntitlementInput,
    scope: { tenantId: string; organizationId: string },
    em: EntityManager,
  ): Promise<WarrantyEntitlementResult>
}

const UNKNOWN_ENTITLEMENT: WarrantyEntitlementResult = {
  warrantyStatus: 'unknown',
  coverageType: null,
  expiresAt: null,
  source: null,
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function resolveStatusFromExpiry(expiresAt: Date | null | undefined, now = new Date()): WarrantyEntitlementResult['warrantyStatus'] {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return 'unknown'
  return expiresAt.getTime() >= now.getTime() ? 'in_warranty' : 'out_of_warranty'
}

export function createWarrantyEntitlementResolver(): WarrantyEntitlementResolver {
  return {
    async resolveEntitlement(input, scope, em) {
      const serialNumber = input.serialNumber?.trim()

      if (serialNumber) {
        const registration = await findOneWithDecryption(
          em,
          WarrantyClaimRegistration,
          {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            serialNumber,
            deletedAt: null,
          },
          {},
          scope,
        )

        if (registration) {
          return {
            warrantyStatus: resolveStatusFromExpiry(registration.warrantyExpiresAt),
            coverageType: registration.coverageType ?? null,
            expiresAt: toIso(registration.warrantyExpiresAt),
            source: 'registration',
          }
        }
      }

      const purchaseDate = parseDate(input.purchaseDate)
      if (!purchaseDate) return UNKNOWN_ENTITLEMENT

      const settings = await resolveEffectiveWarrantyClaimSettings(em, scope)
      const warrantyStatus = computeWarrantyEntitlementPreview(purchaseDate, settings.defaultWarrantyMonths)
      const expiresAt = settings.defaultWarrantyMonths === null
        ? null
        : addWarrantyMonths(purchaseDate, settings.defaultWarrantyMonths)

      return {
        warrantyStatus,
        coverageType: null,
        expiresAt: toIso(expiresAt),
        source: input.orderId ? 'order' : 'resolver',
      }
    },
  }
}
