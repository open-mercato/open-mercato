import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  assistedSellingStoreSettingsSaveSchema,
  assistedSellingStoreSettingsUpdateSchema,
  type AssistedSellingStoreSettingsSaveInput,
} from '../../../data/validators'
import { loadAssistedSellingStoreSettings, toEffectiveAssistedSellingSettings } from '../../../lib/settings'
import type { SaveAssistedSellingStoreSettingsResult } from '../../../commands/settings'
import { ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND } from '../../../commands/shared'

const logger = createLogger('assisted_selling')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['assisted_selling.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['assisted_selling.settings.manage'] },
}

type RouteParams = {
  params?: { storeId?: string } | Promise<{ storeId?: string }>
  auth?: AuthContext
}

type StoreOwnership = { id: string; tenantId: string; organizationId: string }

type StoreByIdReader = {
  findStoreForOrganizations?: (opts: {
    tenantId: string
    organizationIds: string[] | null
    storeId: string
  }) => Promise<StoreOwnership | null>
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  tenantId: string
  organizationId: string
  userId: string
  storeId: string
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function tryResolveStoreReader(container: AppContainer): StoreByIdReader | null {
  try {
    return (container.resolve('storeContextService') as StoreByIdReader | null | undefined) ?? null
  } catch {
    return null
  }
}

async function resolveSettingsContext(req: Request, routeCtx: RouteParams): Promise<SettingsRouteContext> {
  const auth = routeCtx.auth ?? null
  if (!auth?.sub || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'assisted_selling.errors.unauthorized' })
  }
  const container = await createRequestContainer()
  const params = await routeCtx.params
  const storeIdResult = z.string().uuid().safeParse(params?.storeId)
  if (!storeIdResult.success) {
    throw new CrudHttpError(400, { error: 'assisted_selling.errors.invalid_store_id' })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const allowedOrganizationIds = scope ? scope.allowedIds : auth.orgId ? [auth.orgId] : []
  const storeReader = tryResolveStoreReader(container)
  const store = storeReader?.findStoreForOrganizations
    ? await storeReader.findStoreForOrganizations({
        tenantId: auth.tenantId,
        organizationIds: allowedOrganizationIds,
        storeId: storeIdResult.data,
      })
    : null
  if (!store || store.tenantId !== auth.tenantId) {
    throw new CrudHttpError(404, { error: 'assisted_selling.errors.store_not_found' })
  }
  const rbacService = container.resolve<RbacService>('rbacService')
  const allowed = await rbacService.userHasAllFeatures(auth.sub, metadata.GET.requireFeatures, {
    tenantId: store.tenantId,
    organizationId: store.organizationId,
  })
  if (!allowed) {
    throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return {
    ctx,
    em: container.resolve('em') as EntityManager,
    tenantId: auth.tenantId,
    organizationId: store.organizationId,
    userId: auth.sub,
    storeId: store.id,
  }
}

async function respondWithError(err: unknown, fallbackKey: string, code: string) {
  const { translate } = await resolveTranslations()
  if (isCrudHttpError(err)) {
    return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: translate('assisted_selling.errors.invalidInput', 'Invalid input'), issues: err.issues },
      { status: 400 },
    )
  }
  logger.error(`${code} failed`, { err })
  getTelemetryRuntime()?.reportError(err, { module: 'assisted_selling', code })
  return NextResponse.json({ error: translate(fallbackKey) }, { status: 500 })
}

export async function GET(req: Request, routeCtx: RouteParams) {
  try {
    const { em, tenantId, organizationId, storeId } = await resolveSettingsContext(req, routeCtx)
    const record = await loadAssistedSellingStoreSettings(em, { tenantId, organizationId, storeId })
    return NextResponse.json({
      ok: true,
      result: {
        ...toEffectiveAssistedSellingSettings(record),
        storeId,
        updatedAt: toIso(record?.updatedAt),
      },
    })
  } catch (err) {
    return respondWithError(err, 'assisted_selling.errors.load_failed', 'assisted_selling.settings.get')
  }
}

export async function PUT(req: Request, routeCtx: RouteParams) {
  try {
    const { ctx, em, tenantId, organizationId, userId, storeId } = await resolveSettingsContext(req, routeCtx)
    const payload = await readJsonSafe<unknown>(req)
    const parsed = assistedSellingStoreSettingsUpdateSchema.parse(payload)
    const existing = await loadAssistedSellingStoreSettings(em, { tenantId, organizationId, storeId })
    const guarded = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId, tenantId, organizationId },
      input: {
        resourceKind: ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND,
        resourceId: existing?.id ?? null,
        operation: existing ? 'update' : 'create',
        mutationPayload: { ...parsed },
      },
    })
    if (!guarded.ok) return guarded.response

    const guardedPayload = guarded.modifiedPayload
      ? assistedSellingStoreSettingsUpdateSchema.parse({ ...parsed, ...guarded.modifiedPayload })
      : parsed
    const commandInput = assistedSellingStoreSettingsSaveSchema.parse({
      ...guardedPayload,
      tenantId,
      organizationId,
      storeId,
    })
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      AssistedSellingStoreSettingsSaveInput,
      SaveAssistedSellingStoreSettingsResult
    >('assisted_selling.settings.save', { input: commandInput, ctx })

    await guarded.runAfterSuccess()

    return NextResponse.json({
      ok: true,
      result: {
        storeId: result.storeId,
        mode: result.mode,
        proposalTtlSeconds: result.proposalTtlSeconds,
        maxProposalLines: result.maxProposalLines,
        conversationRetentionDays: result.conversationRetentionDays,
        idleCloseDays: result.idleCloseDays,
        updatedAt: result.updatedAt,
      },
    })
  } catch (err) {
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    return respondWithError(err, 'assisted_selling.errors.save_failed', 'assisted_selling.settings.put')
  }
}

const settingsResultSchema = z.object({
  storeId: z.string().uuid(),
  mode: z.enum(['ai', 'rep', 'both', 'off']),
  proposalTtlSeconds: z.number(),
  maxProposalLines: z.number(),
  conversationRetentionDays: z.number(),
  idleCloseDays: z.number(),
  updatedAt: z.string().nullable(),
})

const settingsResponseSchema = z.object({
  ok: z.boolean(),
  result: settingsResultSchema,
})

const settingsErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Assisted Selling',
  summary: 'Assisted selling store settings',
  pathParams: z.object({ storeId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get a store\'s assisted selling settings',
      description: 'Returns the store\'s settings with defaults when no row exists yet. The row belongs to the store\'s organization. Requires assisted_selling.settings.manage.',
      responses: [
        { status: 200, description: 'Current assisted selling settings for the store', schema: settingsResponseSchema },
        { status: 400, description: 'Invalid store id', schema: settingsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 403, description: 'Settings permission missing in the store organization', schema: settingsErrorSchema },
        { status: 404, description: 'Store not found within the caller\'s organizations', schema: settingsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update a store\'s assisted selling settings',
      description: 'Upserts under the store\'s organization. `mode` is limited to `rep | off` in Release 5; any `ai_*` field is refused. Optimistic-locked on `updated_at`.',
      requestBody: {
        contentType: 'application/json',
        schema: assistedSellingStoreSettingsUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Updated assisted selling settings for the store', schema: settingsResponseSchema },
        { status: 400, description: 'Invalid payload or store id', schema: settingsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 403, description: 'Settings permission missing in the store organization', schema: settingsErrorSchema },
        { status: 404, description: 'Store not found within the caller\'s organizations', schema: settingsErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: settingsErrorSchema },
      ],
    },
  },
}
