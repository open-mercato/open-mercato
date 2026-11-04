import { NextResponse } from 'next/server'
import { z } from 'zod'
import { format as formatDateFns } from 'date-fns/format'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { readDateLocaleEnv } from '@open-mercato/shared/lib/date-locale/resolve'
import { dateLocaleSettingsInputSchema } from '@open-mercato/shared/lib/date-locale/validation'
import type { NormalizedDateLocaleSettingsRecord } from '@open-mercato/shared/lib/date-locale/types'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  readTenantDateLocaleSettings,
  reportDateLocaleError,
  resolveDateLocaleSettingsForScope,
} from '../../lib/date-locale-settings'
import {
  DATE_LOCALE_RESOURCE_KIND,
  DATE_LOCALE_UPDATE_COMMAND_ID,
  type UpdateDateLocaleSettingsInput,
} from '../../commands/dateLocale'

const logger = createLogger('configs').child({ component: 'api/date-locale' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configs.date_locale.view'] },
  PUT: { requireAuth: true, requireFeatures: ['configs.date_locale.manage'] },
}

const PATTERN_FIELDS = ['dateFormat', 'dateTimeFormat', 'timeFormat'] as const

const sourceSchema = z.enum(['user', 'tenant', 'env', 'fallback'])
const settingsRecordSchema = z.object({
  locale: z.string().nullable(),
  dateFormat: z.string().nullable(),
  dateTimeFormat: z.string().nullable(),
  timeFormat: z.string().nullable(),
  timeZone: z.string().nullable(),
  firstDayOfWeek: z.number().int().min(0).max(6).nullable(),
})
const responseSchema = z.object({
  settings: settingsRecordSchema,
  effective: settingsRecordSchema,
  sources: z.record(z.string(), sourceSchema),
  envDefaults: settingsRecordSchema,
  updatedAt: z.string().nullable(),
})

type RouteContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  tenantId: string
  organizationId: string | null
  actorId: string
  userId: string | null
  translate: (key: string, fallback?: string) => string
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('configs.errors.unauthorized', 'Unauthorized') })
  }
  const userId = !auth.isApiKey && typeof auth.sub === 'string' && auth.sub.trim().length > 0 ? auth.sub : null
  const actorId =
    userId
    || (typeof auth.userId === 'string' && auth.userId.trim().length > 0 && auth.userId)
    || (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0 && auth.keyId)
    || 'system'
  return { container, auth, tenantId: auth.tenantId, organizationId: auth.orgId ?? null, actorId, userId, translate }
}

async function buildResponse(context: RouteContext) {
  const [stored, resolved] = await Promise.all([
    readTenantDateLocaleSettings(context.container, context.tenantId),
    resolveDateLocaleSettingsForScope(context.container, { tenantId: context.tenantId, userId: context.userId }),
  ])
  const { sources, ...effective } = resolved
  return {
    settings: stored.settings,
    effective,
    sources,
    envDefaults: readDateLocaleEnv(),
    updatedAt: stored.updatedAt,
  }
}

function assertPatternsRender(settings: NormalizedDateLocaleSettingsRecord, translate: RouteContext['translate']) {
  const sample = new Date(Date.UTC(2026, 11, 31, 13, 45))
  const fieldErrors: Record<string, string> = {}
  for (const field of PATTERN_FIELDS) {
    const pattern = settings[field]
    if (!pattern) continue
    try {
      formatDateFns(sample, pattern)
    } catch {
      fieldErrors[field] = translate('configs.dateLocale.errors.pattern.invalidToken', 'This pattern contains an unsupported token.')
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new CrudHttpError(400, {
      error: translate('configs.dateLocale.errors.invalid', 'Some settings are invalid.'),
      fieldErrors,
    })
  }
}

async function GET(req: Request) {
  try {
    const context = await resolveRouteContext(req)
    return NextResponse.json(await buildResponse(context))
  } catch (err) {
    return await errorResponse(err, 'GET')
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveRouteContext(req)
    const raw = await readJsonSafe<unknown>(req, {})
    const parsed = dateLocaleSettingsInputSchema.safeParse(raw ?? {})
    if (!parsed.success) return invalidSettingsResponse(parsed.error.issues, context.translate)
    assertPatternsRender(parsed.data, context.translate)

    // Read-check-write, not compare-and-swap: two PUTs carrying the same version can both pass the
    // check and the later one wins. Accepted for this single settings row (the same trade-off as the
    // other `moduleConfigService` settings routes); the lock still stops every edit made from a
    // stale page, which is the case it exists for.
    const current = await readTenantDateLocaleSettings(context.container, context.tenantId)
    enforceCommandOptimisticLock({
      resourceKind: DATE_LOCALE_RESOURCE_KIND,
      resourceId: context.tenantId,
      current: current.updatedAt,
      request: req,
    })

    const guard = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.actorId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: DATE_LOCALE_RESOURCE_KIND,
        resourceId: context.tenantId,
        operation: 'update',
        mutationPayload: parsed.data,
      },
    })
    if (!guard.ok) return guard.response

    let settings = parsed.data
    if (guard.modifiedPayload) {
      const reparsed = dateLocaleSettingsInputSchema.safeParse({ ...parsed.data, ...guard.modifiedPayload })
      if (!reparsed.success) return invalidSettingsResponse(reparsed.error.issues, context.translate)
      settings = reparsed.data
      assertPatternsRender(settings, context.translate)
    }

    const ctx: CommandRuntimeContext = {
      container: context.container,
      auth: context.auth,
      organizationScope: null,
      selectedOrganizationId: context.organizationId,
      organizationIds: context.organizationId ? [context.organizationId] : null,
      request: req,
    }
    const commandBus = context.container.resolve('commandBus') as CommandBus
    await commandBus.execute<UpdateDateLocaleSettingsInput, { tenantId: string }>(DATE_LOCALE_UPDATE_COMMAND_ID, {
      input: { tenantId: context.tenantId, settings },
      ctx,
    })

    await guard.runAfterSuccess()

    return NextResponse.json(await buildResponse(context))
  } catch (err) {
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    return await errorResponse(err, 'PUT')
  }
}

function invalidSettingsResponse(issues: z.ZodError['issues'], translate: RouteContext['translate']) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    const field = typeof issue.path[0] === 'string' ? issue.path[0] : 'form'
    fieldErrors[field] ??= translate(issue.message, issue.message)
  }
  return NextResponse.json(
    { error: translate('configs.dateLocale.errors.invalid', 'Some settings are invalid.'), fieldErrors },
    { status: 400 },
  )
}

async function errorResponse(err: unknown, method: 'GET' | 'PUT') {
  if (isCrudHttpError(err)) {
    return NextResponse.json(err.body, { status: err.status })
  }
  logger.error(`configs.date-locale.${method} unexpected error`, { err })
  reportDateLocaleError(err, 'configs.date_locale.unexpected')
  const { translate } = await resolveTranslations()
  return NextResponse.json({ error: translate('api.errors.internal', 'Internal error') }, { status: 500 })
}

const getDoc: OpenApiMethodDoc = {
  summary: 'Read date and locale settings',
  description: 'Stored tenant settings, the effective values for the caller (including their personal timezone), the source of each value, and env defaults.',
  tags: ['Configs'],
  responses: [{ status: 200, description: 'Date and locale settings', schema: responseSchema }],
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Update date and locale settings',
  description: 'Replaces the tenant settings. Omitted or `auto` fields inherit the env default. Send the previous `updatedAt` in the optimistic-lock header to detect concurrent edits.',
  tags: ['Configs'],
  requestBody: { schema: dateLocaleSettingsInputSchema },
  responses: [{ status: 200, description: 'Updated date and locale settings', schema: responseSchema }],
  errors: [
    { status: 400, description: 'Invalid locale, timezone, pattern or first day of week' },
    { status: 409, description: 'The settings were changed by someone else since they were loaded' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Configs',
  summary: 'Tenant date and locale settings',
  methods: { GET: getDoc, PUT: putDoc },
}

export { GET, PUT }
