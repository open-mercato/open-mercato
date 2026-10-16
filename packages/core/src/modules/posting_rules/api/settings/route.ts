import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { PostingRulesSettings } from '../../data/entities'
import { updatePostingRulesSettingsSchema, type UpdatePostingRulesSettingsInput } from '../../data/validators'
import type { UpdatePostingRulesSettingsResult } from '../../commands/postingRulesSettings'

// `/api/posting_rules/settings` — thin wrapper around
// `updatePostingRulesSettings` (see the spec's API Contracts).
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['posting_rules.settings.manage'] },
  PATCH: { requireAuth: true, requireFeatures: ['posting_rules.settings.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  tenantId: string
  organizationId: string
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('posting_rules.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('posting_rules.errors.organizationRequired', 'Organization context is required.') })
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return { ctx, em: container.resolve('em') as EntityManager, tenantId: auth.tenantId, organizationId }
}

function buildResult(settings: PostingRulesSettings | null): UpdatePostingRulesSettingsResult {
  return {
    settingsId: settings?.id ?? '',
    clearingAccountId: settings?.clearingAccountId ?? null,
    unallocatedCostAccountId: settings?.unallocatedCostAccountId ?? null,
    updatedAt: toIso(settings?.updatedAt),
  }
}

export async function GET(req: Request) {
  try {
    const { em, tenantId, organizationId } = await resolveSettingsContext(req)
    const settings = await em.findOne(PostingRulesSettings, { tenantId, organizationId })
    return NextResponse.json({ ok: true, result: buildResult(settings) })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: translate('posting_rules.errors.loadFailed', 'Failed to load posting rules settings.') }, { status: 500 })
  }
}

const patchBodySchema = z.object({
  clearingAccountId: z.uuid().nullable().optional(),
  unallocatedCostAccountId: z.uuid().nullable().optional(),
})

export async function PATCH(req: Request) {
  try {
    const { ctx, tenantId, organizationId } = await resolveSettingsContext(req)
    const { translate } = await resolveTranslations()
    const body = patchBodySchema.parse(await readJsonSafe(req, {}))
    const commandInput: UpdatePostingRulesSettingsInput = updatePostingRulesSettingsSchema.parse({
      organizationId,
      tenantId,
      ...body,
    })
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    // `commandBus.execute` resolves `CommandExecuteResult<TResult>`
    // (`{ result, logEntry }`) — unwrap `.result` before returning it as
    // this route's own `result` field.
    const executed = await commandBus.execute<UpdatePostingRulesSettingsInput, UpdatePostingRulesSettingsResult>(
      'posting_rules.updatePostingRulesSettings',
      { input: commandInput, ctx },
    )
    return NextResponse.json({ ok: true, result: executed.result })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('posting_rules.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    return NextResponse.json({ error: translate('posting_rules.errors.saveFailed', 'Failed to save posting rules settings.') }, { status: 400 })
  }
}

const settingsResultSchema = z.object({
  settingsId: z.string(),
  clearingAccountId: z.uuid().nullable(),
  unallocatedCostAccountId: z.uuid().nullable(),
  updatedAt: z.string().nullable(),
})

const settingsResponseSchema = z.object({ ok: z.boolean(), result: settingsResultSchema })
const settingsErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Posting Rules Engine',
  summary: 'Posting rules settings (clearing / unallocated-cost accounts)',
  methods: {
    GET: {
      summary: 'Get posting rules settings',
      responses: [
        { status: 200, description: 'Current posting rules settings', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
      ],
    },
    PATCH: {
      summary: 'Update posting rules settings',
      requestBody: { contentType: 'application/json', schema: patchBodySchema },
      responses: [
        { status: 200, description: 'Updated posting rules settings', schema: settingsResponseSchema },
        { status: 400, description: 'Invalid payload', schema: settingsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: settingsErrorSchema },
      ],
    },
  },
}
