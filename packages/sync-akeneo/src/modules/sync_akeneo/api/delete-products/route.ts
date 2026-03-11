import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { SyncCursor } from '@open-mercato/core/modules/data_sync/data/entities'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'

const requestSchema = z.object({
  confirm: z.literal(true),
})

const responseSchema = z.object({
  ok: z.boolean(),
  deletedProductCount: z.number().int().nonnegative(),
  message: z.string(),
})

const PRODUCT_MAPPING_ENTITY_TYPES = [
  'catalog_product',
  'catalog_product_variant',
  'catalog_offer',
  'catalog_product_price',
  'attachment',
] as const

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['Akeneo'],
  summary: 'Delete all Akeneo-imported products for the current organization',
}

function buildCommandContext(scope: { organizationId: string; tenantId: string }, container: Awaited<ReturnType<typeof createRequestContainer>>): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      deletedProductCount: 0,
      message: 'Unauthorized',
    }), { status: 401 })
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      deletedProductCount: 0,
      message: 'Invalid payload',
    }), { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const commandBus = container.resolve('commandBus') as CommandBus
  const scope = {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  }

  const productMappings = await em.find(SyncExternalIdMapping, {
    integrationId: 'sync_akeneo',
    internalEntityType: 'catalog_product',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  }, {
    fields: ['internalEntityId', 'createdAt'],
    orderBy: { createdAt: 'asc' },
  })

  const productIds = Array.from(new Set(
    (productMappings as Array<{ internalEntityId: string }>).map((entry) => entry.internalEntityId),
  ))

  if (productIds.length === 0) {
    return NextResponse.json(responseSchema.parse({
      ok: true,
      deletedProductCount: 0,
      message: 'No Akeneo-imported products were found.',
    }))
  }

  const commandCtx = buildCommandContext(scope, container)
  let deletedProductCount = 0

  for (const productId of productIds) {
    try {
      await commandBus.execute<{ body?: Record<string, unknown> }, { productId: string }>('catalog.products.delete', {
        input: { body: { id: productId } },
        ctx: commandCtx,
      })
      deletedProductCount += 1
    } catch {
      continue
    }
  }

  await em.nativeDelete(SyncExternalIdMapping, {
    integrationId: 'sync_akeneo',
    internalEntityType: { $in: [...PRODUCT_MAPPING_ENTITY_TYPES] },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  await em.nativeDelete(SyncCursor, {
    integrationId: 'sync_akeneo',
    entityType: 'products',
    direction: 'import',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  return NextResponse.json(responseSchema.parse({
    ok: true,
    deletedProductCount,
    message: deletedProductCount === 1
      ? 'Deleted 1 Akeneo-imported product.'
      : `Deleted ${deletedProductCount} Akeneo-imported products.`,
  }))
}
