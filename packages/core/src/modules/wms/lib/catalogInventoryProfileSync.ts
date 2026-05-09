import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import { ProductInventoryProfile } from '../data/entities'
import {
  catalogInventoryProfileIntentSchema,
  type CatalogInventoryProfileIntent,
} from './catalogInventoryProfileIntent'

type SyncTarget = 'product' | 'variant'

type SyncCatalogInventoryProfileInput = {
  intent: CatalogInventoryProfileIntent
  target: SyncTarget
  recordId: string
  organizationId: string
  tenantId: string
  userId: string
  container: AwilixContainer
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildCommandContext(params: {
  container: AwilixContainer
  organizationId: string
  tenantId: string
  userId: string
}): CommandRuntimeContext {
  const auth: AuthContext = {
    sub: params.userId,
    userId: params.userId,
    tenantId: params.tenantId,
    orgId: params.organizationId,
  }

  return {
    container: params.container,
    auth,
    organizationScope: null,
    selectedOrganizationId: params.organizationId,
    organizationIds: [params.organizationId],
  }
}

async function loadExistingProfile(params: {
  organizationId: string
  tenantId: string
  target: SyncTarget
  recordId: string
  catalogProductId: string
  container: AwilixContainer
}) {
  const em = params.container.resolve('em')
  const scope = {
    organizationId: params.organizationId,
    tenantId: params.tenantId,
  }

  if (params.target === 'variant') {
    return findOneWithDecryption(
      em,
      ProductInventoryProfile,
      {
        organizationId: params.organizationId,
        tenantId: params.tenantId,
        deletedAt: null,
        catalogVariantId: params.recordId,
      } as never,
      undefined,
      scope,
    )
  }

  return findOneWithDecryption(
    em,
    ProductInventoryProfile,
    {
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      deletedAt: null,
      catalogProductId: params.catalogProductId,
      catalogVariantId: null,
    } as never,
    undefined,
    scope,
  )
}

async function resolveCatalogProductId(params: {
  target: SyncTarget
  recordId: string
  organizationId: string
  tenantId: string
  container: AwilixContainer
}): Promise<string> {
  if (params.target === 'product') return params.recordId

  // Read the variant -> product_id mapping via QueryEngine so this module does
  // not import the catalog ORM entity directly. queryEngine resolves the
  // base table via Mikro-ORM metadata, so the only cross-module surface we
  // depend on is the public catalog entity id from the `E` registry.
  const queryEngine = params.container.resolve('queryEngine') as QueryEngine
  const result = await queryEngine.query<{ id?: string; product_id?: string }>(
    E.catalog.catalog_product_variant,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      filters: { id: { $eq: params.recordId } },
      fields: ['id', 'product_id'],
      page: { page: 1, pageSize: 1 },
    },
  )

  const variantRow = result.items[0]
  if (!variantRow) {
    throw new Error(`Variant ${params.recordId} not found for WMS profile sync`)
  }

  const productId = typeof variantRow.product_id === 'string' ? variantRow.product_id : null
  if (!productId) {
    throw new Error(
      `Variant ${params.recordId} is missing product context for WMS profile sync`,
    )
  }

  return productId
}

export async function syncCatalogInventoryProfile(
  input: SyncCatalogInventoryProfileInput,
): Promise<void> {
  const intent = catalogInventoryProfileIntentSchema.parse(input.intent)
  const commandBus = input.container.resolve('commandBus') as CommandBus
  const ctx = buildCommandContext(input)
  const catalogProductId = await resolveCatalogProductId({
    target: input.target,
    recordId: input.recordId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    container: input.container,
  })

  const existingProfile = await loadExistingProfile({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    target: input.target,
    recordId: input.recordId,
    catalogProductId,
    container: input.container,
  })

  if (!intent.manageInventory) {
    if (!existingProfile) return
    await commandBus.execute('wms.inventoryProfiles.delete', {
      input: { id: existingProfile.id },
      ctx,
    })
    return
  }

  const profileInput = {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    catalogProductId,
    catalogVariantId: input.target === 'variant' ? input.recordId : null,
    defaultUom: normalizeOptionalString(intent.defaultUom),
    defaultStrategy: intent.defaultStrategy,
    trackLot: intent.trackLot ?? false,
    trackSerial: intent.trackSerial ?? false,
    trackExpiration: intent.trackExpiration ?? false,
    reorderPoint: intent.reorderPoint ?? 0,
    safetyStock: intent.safetyStock ?? 0,
  }

  if (existingProfile) {
    await commandBus.execute('wms.inventoryProfiles.update', {
      input: {
        id: existingProfile.id,
        ...profileInput,
      },
      ctx,
    })
    return
  }

  await commandBus.execute('wms.inventoryProfiles.create', {
    input: profileInput,
    ctx,
  })
}
