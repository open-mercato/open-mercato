import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import {
  EUDR_COMMODITIES,
  productMappingCreateSchema,
} from '../../../../data/validators'
import { suggestCommodityForHsCode } from '../../../../lib/reference-data'

const logger = createLogger('eudr').child({ component: 'api/product-mappings/suggestions/apply' })

const CATALOG_LOOKUP_PAGE_SIZE = 100

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['eudr.mappings.manage'] },
}

const applyItemSchema = z.object({
  productId: z.string().uuid(),
  commodity: z.enum(EUDR_COMMODITIES),
  hsCode: z.string().max(20).optional().nullable(),
})

const applySchema = z
  .object({
    items: z.array(applyItemSchema).max(100).optional(),
    productIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .superRefine((value, context) => {
    if ((value.items?.length ?? 0) > 0 || (value.productIds?.length ?? 0) > 0) return
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'eudr.errors.mapping_suggestions_apply_failed',
    })
  })

type ApplyItem = z.infer<typeof applyItemSchema>
type ApplyFailure = { productId: string; errorKey: string }
type ProductSnapshot = { name?: string | null; sku?: string | null }
type CatalogProductInfo = { snapshot: ProductSnapshot | null; hsCode: string | null }
type CatalogProductRecord = Record<string, unknown> & {
  id?: unknown
  title?: unknown
  name?: unknown
  sku?: unknown
  hs_code?: unknown
}
type RequestContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
}
type CommandCreateResult = { entityId?: string; id?: string }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

async function runGuards(
  ctx: CommandRuntimeContext,
  input: MutationGuardInput,
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const legacyGuard = bridgeLegacyGuard(ctx.container)
  const guards = [...getAllMutationGuardInstances(), ...(legacyGuard ? [legacyGuard] : [])]
  return runMutationGuards(guards, input, {
    userFeatures: resolveUserFeatures(ctx.auth),
  })
}

async function runGuardAfterSuccessCallbacks(
  callbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>,
  input: {
    tenantId: string
    organizationId: string
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create'
    requestMethod: string
    requestHeaders: Headers
  },
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    try {
      await callback.guard.afterSuccess({
        ...input,
        metadata: callback.metadata ?? null,
      })
    } catch (err) {
      logger.warn('Mutation guard afterSuccess callback failed', { err })
    }
  }
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('eudr.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('eudr.errors.organization_required', 'Organization context is required'),
    })
  }

  return {
    tenantId: auth.tenantId,
    organizationId,
    ctx: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
  }
}

async function loadCatalogProductInfo(ctx: RequestContext, productIds: string[]): Promise<Map<string, CatalogProductInfo>> {
  const info = new Map<string, CatalogProductInfo>()
  for (const productId of productIds) info.set(productId, { snapshot: null, hsCode: null })
  if (!productIds.length) return info

  try {
    const queryEngine = ctx.ctx.container.resolve('queryEngine') as QueryEngine
    // `items` and `productIds` are capped at 100 each, so their union can reach
    // 200 — chunk the lookup to keep every page within the pageSize <= 100 rule.
    const chunks: string[][] = []
    for (let index = 0; index < productIds.length; index += CATALOG_LOOKUP_PAGE_SIZE) {
      chunks.push(productIds.slice(index, index + CATALOG_LOOKUP_PAGE_SIZE))
    }
    const products: CatalogProductRecord[] = []
    for (const chunk of chunks) {
      const result = await queryEngine.query<CatalogProductRecord>(E.catalog.catalog_product, {
        fields: ['id', 'title', 'name', 'sku', 'hs_code'],
        filters: { id: { $in: chunk } },
        page: { page: 1, pageSize: chunk.length },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      products.push(...result.items)
    }
    for (const product of products) {
      const id = readString(product.id)
      if (!id) continue
      info.set(id, {
        snapshot: {
          name: readString(product.title) ?? readString(product.name),
          sku: readString(product.sku),
        },
        hsCode: readString(product.hs_code),
      })
    }
  } catch {
    return info
  }

  return info
}

function resolveApplyItems(
  input: z.infer<typeof applySchema>,
  catalogInfo: Map<string, CatalogProductInfo>,
): { items: ApplyItem[]; failed: ApplyFailure[] } {
  const items: ApplyItem[] = [...(input.items ?? [])]
  const failed: ApplyFailure[] = []
  const explicitIds = new Set(items.map((item) => item.productId))

  for (const productId of input.productIds ?? []) {
    if (explicitIds.has(productId)) continue
    explicitIds.add(productId)
    const hsCode = catalogInfo.get(productId)?.hsCode ?? null
    const suggestedCommodity = suggestCommodityForHsCode(hsCode)
    if (!hsCode || !suggestedCommodity) {
      failed.push({ productId, errorKey: 'eudr.errors.mapping_suggestions_apply_failed' })
      continue
    }
    items.push({ productId, commodity: suggestedCommodity, hsCode })
  }

  return { items, failed }
}

function errorKeyFromError(error: unknown): string {
  if (isCrudHttpError(error)) {
    const bodyError = error.body?.error
    return typeof bodyError === 'string' && bodyError.length > 0 ? bodyError : 'eudr.errors.mapping_suggestions_apply_failed'
  }
  if (error instanceof z.ZodError) {
    const firstMessage = error.issues[0]?.message
    return typeof firstMessage === 'string' && firstMessage.length > 0 ? firstMessage : 'eudr.errors.mapping_suggestions_apply_failed'
  }
  return 'eudr.errors.mapping_suggestions_apply_failed'
}

async function createMapping(args: {
  commandBus: CommandBus
  ctx: RequestContext
  item: ApplyItem
  productSnapshot: ProductSnapshot | null
}): Promise<string | null> {
  const parsed = productMappingCreateSchema.parse({
    productId: args.item.productId,
    commodity: args.item.commodity,
    hsCode: args.item.hsCode ?? null,
    productSnapshot: args.productSnapshot,
  })
  const { result } = await args.commandBus.execute<typeof parsed & { tenantId: string; organizationId: string }, CommandCreateResult>(
    'eudr.product_mappings.create',
    {
      input: {
        ...parsed,
        tenantId: args.ctx.tenantId,
        organizationId: args.ctx.organizationId,
      },
      ctx: args.ctx.ctx,
      metadata: {
        tenantId: args.ctx.tenantId,
        organizationId: args.ctx.organizationId,
        resourceKind: 'eudr.product_mapping',
        context: { cacheAliases: ['eudr.product_mapping'] },
      },
    },
  )
  return result?.entityId ?? result?.id ?? null
}

export async function POST(req: Request) {
  try {
    const requestContext = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await req.json().catch(() => ({}))
    const input = applySchema.parse(payload)
    const catalogInfo = await loadCatalogProductInfo(
      requestContext,
      Array.from(new Set([
        ...(input.items ?? []).map((item) => item.productId),
        ...(input.productIds ?? []),
      ])),
    )
    const resolved = resolveApplyItems(input, catalogInfo)
    const guardResult = await runGuards(requestContext.ctx, {
      tenantId: requestContext.tenantId,
      organizationId: requestContext.organizationId,
      userId: requestContext.ctx.auth?.sub ?? '',
      resourceKind: 'eudr.product_mapping',
      resourceId: null,
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { items: resolved.items },
    })
    if (!guardResult.ok) {
      return Response.json(
        guardResult.errorBody ?? { error: translate('eudr.errors.operation_blocked', 'Operation blocked by guard') },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    const commandBus = requestContext.ctx.container.resolve('commandBus') as CommandBus
    const failed: ApplyFailure[] = [...resolved.failed]
    const createdIds: string[] = []

    const guardItems = Array.isArray((guardResult.modifiedPayload as { items?: unknown } | undefined)?.items)
      ? ((guardResult.modifiedPayload as { items: unknown[] }).items.filter((entry): entry is typeof resolved.items[number] => (
          typeof (entry as { productId?: unknown })?.productId === 'string'
          && typeof (entry as { commodity?: unknown })?.commodity === 'string'
        )))
      : resolved.items

    for (const item of guardItems) {
      try {
        const id = await createMapping({
          commandBus,
          ctx: requestContext,
          item,
          productSnapshot: catalogInfo.get(item.productId)?.snapshot ?? null,
        })
        if (id) createdIds.push(id)
      } catch (error) {
        failed.push({ productId: item.productId, errorKey: errorKeyFromError(error) })
      }
    }

    if (guardResult.afterSuccessCallbacks.length) {
      for (const id of createdIds) {
        await runGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, {
          tenantId: requestContext.tenantId,
          organizationId: requestContext.organizationId,
          userId: requestContext.ctx.auth?.sub ?? '',
          resourceKind: 'eudr.product_mapping',
          resourceId: id,
          operation: 'create',
          requestMethod: req.method,
          requestHeaders: req.headers,
        })
      }
    }

    return Response.json({ created: createdIds.length, failed })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return Response.json(error.body, { status: error.status })
    }
    const { translate } = await resolveTranslations()
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: translate('eudr.errors.mapping_suggestions_apply_failed', 'Failed to apply EUDR mapping suggestions') },
        { status: 400 },
      )
    }
    logger.error('Product mapping suggestions apply failed', { err: error })
    return Response.json(
      { error: translate('eudr.errors.mapping_suggestions_apply_failed', 'Failed to apply EUDR mapping suggestions') },
      { status: 500 },
    )
  }
}

const applyResponseSchema = z.object({
  created: z.number(),
  failed: z.array(z.object({
    productId: z.string().uuid(),
    errorKey: z.string(),
  })),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'Apply EUDR product mapping suggestions',
  methods: {
    POST: {
      summary: 'Apply mapping suggestions',
      requestBody: {
        contentType: 'application/json',
        schema: applySchema,
      },
      responses: [
        { status: 200, description: 'Apply result', schema: applyResponseSchema },
        { status: 400, description: 'Invalid apply payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 500, description: 'Mapping suggestion apply failed', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
