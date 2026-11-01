import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  assistedSellingStoreSettingsSaveSchema,
  assistedSellingStoreSettingsUpdateSchema,
  type AssistedSellingStoreSettingsSaveInput,
} from '../../../data/validators'
import {
  loadAssistedSellingStoreSettings,
  resolveEffectiveAssistedSellingSettings,
  type AssistedSellingEffectiveSettings,
} from '../../../lib/settings'
import { type SaveAssistedSellingStoreSettingsResult } from '../../../commands/settings'
import { ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND } from '../../../commands/shared'

const logger = createLogger('assisted_selling')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['assisted_selling.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['assisted_selling.settings.manage'] },
}

type RouteParams = { params?: { storeId?: string } | Promise<{ storeId?: string }> }

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  tenantId: string
  organizationId: string
  userId: string
  storeId: string
  translate: (key: string, fallback?: string) => string
}

type SettingsResponseResult = AssistedSellingEffectiveSettings & {
  storeId: string
  updatedAt: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function resolveSettingsContext(req: Request, routeCtx: RouteParams): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('assisted_selling.errors.unauthorized', 'Unauthorized') })
  }
  const params = await routeCtx.params
  const storeIdResult = z.string().uuid().safeParse(params?.storeId)
  if (!storeIdResult.success) {
    throw new CrudHttpError(400, { error: translate('assisted_selling.errors.invalid_store_id', 'Invalid store id') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('assisted_selling.errors.organization_required', 'Organization context is required') })
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return {
    ctx,
    em: container.resolve('em') as EntityManager,
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub ?? '',
    storeId: storeIdResult.data,
    translate,
  }
}

async function buildSettingsResult(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string; storeId: string },
): Promise<SettingsResponseResult> {
  const record = await loadAssistedSellingStoreSettings(em, scope)
  const effectiveSettings = await resolveEffectiveAssistedSellingSettings(em, scope)
  return {
    ...effectiveSettings,
    storeId: scope.storeId,
    updatedAt: toIso(record?.updatedAt),
  }
}

export async function GET(req: Request, routeCtx: RouteParams) {
  try {
    const { em, tenantId, organizationId, storeId } = await resolveSettingsContext(req, routeCtx)
    const result = await buildSettingsResult(em, { tenantId, organizationId, storeId })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    logger.error('assisted_selling.settings.get failed', { err })
    return NextResponse.json({ error: translate('assisted_selling.errors.load_failed', 'Failed to load assisted-selling settings.') }, { status: 500 })
  }
}

export async function PUT(req: Request, routeCtx: RouteParams) {
  try {
    const { ctx, em, tenantId, organizationId, userId, storeId, translate } = await resolveSettingsContext(req, routeCtx)
    const payload = toRecord(await readJsonSafe(req, {}))
    const parsed = assistedSellingStoreSettingsUpdateSchema.parse(payload)
    const parsedPayload: Record<string, unknown> = { ...parsed }
    const existing = await loadAssistedSellingStoreSettings(em, { tenantId, organizationId, storeId })
    const guarded = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId, tenantId, organizationId },
      input: {
        resourceKind: ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND,
        resourceId: existing?.id ?? null,
        operation: existing ? 'update' : 'create',
        mutationPayload: parsedPayload,
      },
    })
    if (!guarded.ok) return guarded.response

    const guardedPayload = guarded.modifiedPayload
      ? assistedSellingStoreSettingsUpdateSchema.parse({ ...parsedPayload, ...guarded.modifiedPayload })
      : parsed
    const commandInput = assistedSellingStoreSettingsSaveSchema.parse({
      ...withScopedPayload({ ...guardedPayload }, ctx, translate),
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
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('assisted_selling.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('assisted_selling.settings.put failed', { err })
    return NextResponse.json({ error: translate('assisted_selling.errors.save_failed', 'Failed to save assisted-selling settings') }, { status: 400 })
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
  summary: 'Assisted-selling store settings',
  pathParams: z.object({ storeId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get a store\'s assisted-selling settings',
      description: 'Returns the store\'s settings with defaults when no row exists yet. Requires assisted_selling.settings.manage.',
      responses: [
        { status: 200, description: 'Current assisted-selling settings for the store', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Invalid store id or scope', schema: settingsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update a store\'s assisted-selling settings',
      description: 'Upserts. `mode` is limited to `rep | off` in Release 5 (S10); optimistic-locked on `updated_at`.',
      requestBody: {
        contentType: 'application/json',
        schema: assistedSellingStoreSettingsUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Updated assisted-selling settings for the store', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Invalid payload', schema: settingsErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: settingsErrorSchema },
      ],
    },
  },
}
