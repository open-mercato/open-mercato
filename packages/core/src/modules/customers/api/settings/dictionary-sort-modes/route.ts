import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { CacheStrategy } from '@open-mercato/cache'
import {
  dictionaryEntrySortModeSchema,
  type DictionaryEntrySortMode,
} from '@open-mercato/core/modules/dictionaries/lib/entrySort'
import {
  customerDictionarySortModesUpsertSchema,
  type CustomerDictionarySortModesUpsertInput,
} from '../../../data/validators'
import { loadCustomerSettings } from '../../../commands/settings'
import { withScopedPayload } from '../../utils'
import {
  BUILTIN_DICTIONARY_ROUTE_KINDS,
  dictionaryKindSchema,
  mapDictionaryKind,
} from '../../dictionaries/context'
import { invalidateDictionaryCache } from '../../dictionaries/cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
  PATCH: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
  em: EntityManager
  cache?: CacheStrategy
}

const dictionarySortModesPayloadSchema = z.object({
  dictionarySortModes: z.record(dictionaryKindSchema, dictionaryEntrySortModeSchema),
})

const dictionarySortModesResponseSchema = z.object({
  dictionarySortModes: z.record(z.string(), dictionaryEntrySortModeSchema),
})

const dictionarySortModesErrorSchema = z.object({
  error: z.string(),
})

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, {
      error: translate('customers.errors.unauthorized', 'Unauthorized'),
    })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('customers.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  let cache: CacheStrategy | undefined
  try {
    cache = container.resolve('cache') as CacheStrategy
  } catch {}

  return {
    ctx,
    tenantId: auth.tenantId,
    organizationId,
    translate,
    em: container.resolve('em') as EntityManager,
    cache,
  }
}

function resolveActorId(ctx: CommandRuntimeContext): string {
  const auth = ctx.auth
  if (auth && typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (auth && typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (auth && typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

function normalizeDictionarySortModes(value: unknown): Partial<Record<string, DictionaryEntrySortMode>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Partial<Record<string, DictionaryEntrySortMode>> = {}
  for (const [rawKind, rawMode] of Object.entries(value as Record<string, unknown>)) {
    const kind = dictionaryKindSchema.safeParse(rawKind)
    const mode = dictionaryEntrySortModeSchema.safeParse(rawMode)
    if (kind.success && mode.success) {
      result[kind.data] = mode.data
    }
  }
  return result
}

async function invalidateCustomerDictionarySortCache(
  cache: CacheStrategy | undefined,
  tenantId: string,
  organizationId: string,
  dictionarySortModes: Partial<Record<string, DictionaryEntrySortMode>>,
) {
  const routeKinds = new Set<string>([
    ...BUILTIN_DICTIONARY_ROUTE_KINDS,
    ...Object.keys(dictionarySortModes),
  ])
  for (const routeKind of routeKinds) {
    const parsed = dictionaryKindSchema.safeParse(routeKind)
    if (!parsed.success) continue
    const { mappedKind } = mapDictionaryKind(parsed.data)
    await invalidateDictionaryCache(cache, {
      tenantId,
      mappedKind,
      organizationIds: [organizationId],
    })
  }
}

export async function GET(req: Request) {
  try {
    const { em, tenantId, organizationId } = await resolveSettingsContext(req)
    const record = await loadCustomerSettings(em, { tenantId, organizationId })
    return NextResponse.json({
      dictionarySortModes: normalizeDictionarySortModes(record?.dictionarySortModes),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('customers.settings.dictionary-sort-modes.get failed', { err })
    return NextResponse.json(
      { error: translate('customers.errors.lookup_failed', 'Failed to load settings') },
      { status: 400 },
    )
  }
}

export async function PATCH(req: Request) {
  try {
    const { ctx, tenantId, organizationId, translate, cache, em } = await resolveSettingsContext(req)
    const payload = dictionarySortModesPayloadSchema.parse(await readJsonSafe(req, {}))
    const record = await loadCustomerSettings(em, { tenantId, organizationId })
    const dictionarySortModes = {
      ...normalizeDictionarySortModes(record?.dictionarySortModes),
      ...payload.dictionarySortModes,
    }
    const scoped = withScopedPayload({ dictionarySortModes }, ctx, translate)
    const input = customerDictionarySortModesUpsertSchema.parse(scoped)
    const userId = resolveActorId(ctx)

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId,
      resourceKind: 'customers.settings',
      resourceId: organizationId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      CustomerDictionarySortModesUpsertInput,
      { settingsId: string; dictionarySortModes: CustomerDictionarySortModesUpsertInput['dictionarySortModes'] }
    >('customers.settings.save_dictionary_sort_modes', { input, ctx })

    await invalidateCustomerDictionarySortCache(cache, tenantId, organizationId, input.dictionarySortModes)

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.settings',
        resourceId: organizationId,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({
      dictionarySortModes: normalizeDictionarySortModes(result?.dictionarySortModes ?? input.dictionarySortModes),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('customers.settings.dictionary-sort-modes.patch failed', { err })
    return NextResponse.json(
      { error: translate('customers.errors.save_failed', 'Failed to save settings') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer dictionary entry sort modes',
  methods: {
    GET: {
      summary: 'Retrieve dictionary sort modes',
      description: 'Returns entry sort preferences for customer dictionaries in the selected organization.',
      responses: [
        { status: 200, description: 'Current dictionary sort modes', schema: dictionarySortModesResponseSchema },
        { status: 401, description: 'Unauthorized', schema: dictionarySortModesErrorSchema },
        { status: 400, description: 'Organization context missing', schema: dictionarySortModesErrorSchema },
      ],
    },
    PATCH: {
      summary: 'Update dictionary sort modes',
      description: 'Updates entry sort preferences for customer dictionaries in the selected organization.',
      requestBody: {
        contentType: 'application/json',
        schema: dictionarySortModesPayloadSchema,
      },
      responses: [
        { status: 200, description: 'Updated dictionary sort modes', schema: dictionarySortModesResponseSchema },
        { status: 401, description: 'Unauthorized', schema: dictionarySortModesErrorSchema },
        { status: 400, description: 'Invalid payload or organization context', schema: dictionarySortModesErrorSchema },
      ],
    },
  },
}
