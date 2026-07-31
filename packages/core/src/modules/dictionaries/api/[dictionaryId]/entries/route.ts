import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runWithCacheTenant } from '@open-mercato/cache'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext, resolveDictionaryActorId } from '@open-mercato/core/modules/dictionaries/api/context'
import { createDictionaryEntrySchema } from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createDictionaryEntrySchema as createEntryDocSchema,
  dictionaryEntryListResponseSchema,
  dictionaryEntryResponseSchema,
  dictionaryIdParamsSchema,
  dictionariesErrorSchema,
  dictionariesTag,
} from '../../openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  buildCollectionTags,
  buildRecordTag,
  isCrudCacheEnabled,
  resolveCrudCache,
} from '@open-mercato/shared/lib/crud/cache'
import {
  resolveDictionaryEntrySortMode,
  sortDictionaryEntries,
} from '@open-mercato/core/modules/dictionaries/lib/entrySort'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dictionaries').child({ component: 'entries-api' })

const paramsSchema = z.object({ dictionaryId: z.string().uuid() })

const DICTIONARY_ENTRY_RESOURCE = 'dictionaries.entry'
const DICTIONARY_DEFINITION_RESOURCE = 'dictionaries.dictionary'
const DICTIONARY_ENTRIES_TTL_MS = 5 * 60_000

function buildEntriesCacheKey(params: {
  dictionaryId: string
  organizationId: string | null
  sortMode: string
}): string {
  return `dictionaries:entries:${params.dictionaryId}:org=${params.organizationId ?? 'null'}:sort=${params.sortMode}`
}

async function loadDictionary(
  context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>,
  id: string,
  options: { allowInherited?: boolean } = {},
) {
  const { allowInherited = false } = options
  if (!allowInherited && !context.organizationId) {
    throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.organization_required', 'Organization context is required') })
  }
  const baseFilter = {
    id,
    tenantId: context.tenantId,
    deletedAt: null,
  }
  const filter = allowInherited
    ? {
        ...baseFilter,
        ...(context.readableOrganizationIds.length
          ? { organizationId: { $in: context.readableOrganizationIds } }
          : {}),
      }
    : {
        ...baseFilter,
        organizationId: context.organizationId,
      }
  const dictionary = await context.em.findOne(Dictionary, filter)
  if (!dictionary) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
  }
  return dictionary
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dictionaries.view'] },
  POST: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

export async function GET(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    if (!context.auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const dictionary = await loadDictionary(context, dictionaryId, { allowInherited: true })
    const dictionaryTenantId = dictionary.tenantId
    const dictionaryOrgId = dictionary.organizationId ?? null
    const sortMode = resolveDictionaryEntrySortMode(dictionary.entrySortMode)

    // Dictionary CF selects hit this on every CrudForm open, so cache the
    // decrypted+sorted options payload. The entry writes flow through the
    // command bus (resourceKind dictionaries.entry), which already flushes the
    // matching collection tag post-commit — no new invalidation wiring needed.
    const cache = isCrudCacheEnabled() ? resolveCrudCache(context.container) : null
    const cacheKey = cache
      ? buildEntriesCacheKey({ dictionaryId, organizationId: dictionaryOrgId, sortMode })
      : null

    if (cache && cacheKey) {
      const cached = await runWithCacheTenant(dictionaryTenantId, () => cache.get(cacheKey))
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const entries = await findWithDecryption(
      context.em,
      DictionaryEntry,
      {
        dictionary,
        organizationId: dictionary.organizationId,
        tenantId: dictionary.tenantId,
      },
      {},
      { tenantId: dictionary.tenantId, organizationId: dictionary.organizationId },
    )
    const sortedEntries = sortDictionaryEntries(entries, sortMode)

    const payload = {
      items: sortedEntries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
        position: entry.position ?? 0,
        isDefault: entry.isDefault ?? false,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    }

    if (cache && cacheKey) {
      try {
        await runWithCacheTenant(dictionaryTenantId, () =>
          cache.set(cacheKey, payload, {
            ttl: DICTIONARY_ENTRIES_TTL_MS,
            tags: [
              ...buildCollectionTags(DICTIONARY_ENTRY_RESOURCE, dictionaryTenantId, [dictionaryOrgId]),
              buildRecordTag(DICTIONARY_DEFINITION_RESOURCE, dictionaryTenantId, dictionaryId),
            ],
          }),
        )
      } catch {}
    }

    return NextResponse.json(payload)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to load dictionary entries', { err })
    return NextResponse.json({ error: 'Failed to load dictionary entries' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    if (!context.auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const payload = createDictionaryEntrySchema.parse(await req.json().catch(() => ({})))
    const guardUserId = resolveDictionaryActorId(context.auth)
    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: guardUserId,
      resourceKind: DICTIONARY_ENTRY_RESOURCE,
      resourceId: dictionaryId,
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    // These nested routes do not use makeCrudRoute, so we invoke the command bus directly.
    const commandBus = (context.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute('dictionaries.entries.create', {
      input: { ...payload, dictionaryId },
      ctx: context.ctx,
    })
    const createResult = (result ?? {}) as { entryId?: string | null }
    const createdEntryId = typeof createResult.entryId === 'string' ? createResult.entryId : null
    if (!createdEntryId) {
      throw new CrudHttpError(500, { error: context.translate('dictionaries.errors.entry_create_failed', 'Failed to create dictionary entry') })
    }
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: guardUserId,
        resourceKind: DICTIONARY_ENTRY_RESOURCE,
        resourceId: createdEntryId,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    const entry = await findOneWithDecryption(
      context.em.fork(),
      DictionaryEntry,
      createdEntryId,
      { populate: ['dictionary'] },
      { tenantId: context.auth.tenantId ?? null, organizationId: context.auth.orgId ?? null },
    )
    if (!entry) {
      throw new CrudHttpError(500, { error: context.translate('dictionaries.errors.entry_create_failed', 'Failed to create dictionary entry') })
    }
    const response = NextResponse.json({
      id: entry.id,
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
      position: entry.position ?? 0,
      isDefault: entry.isDefault ?? false,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }, { status: 201 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'dictionaries.entry',
          resourceId: createdEntryId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to create dictionary entry', { err })
    return NextResponse.json({ error: 'Failed to create dictionary entry' }, { status: 500 })
  }
}

const dictionaryEntriesGetDoc: OpenApiMethodDoc = {
  summary: 'List dictionary entries',
  description: 'Returns entries for the specified dictionary ordered by its configured entry sort mode.',
  tags: [dictionariesTag],
  responses: [
    { status: 200, description: 'Dictionary entries.', schema: dictionaryEntryListResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid parameters', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to load dictionary entries', schema: dictionariesErrorSchema },
  ],
}

const dictionaryEntriesPostDoc: OpenApiMethodDoc = {
  summary: 'Create dictionary entry',
  description: 'Creates a new entry in the specified dictionary.',
  tags: [dictionariesTag],
  requestBody: {
    contentType: 'application/json',
    schema: createEntryDocSchema,
    description: 'Entry value, label, and optional presentation metadata.',
  },
  responses: [
    { status: 201, description: 'Dictionary entry created.', schema: dictionaryEntryResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to create dictionary entry', schema: dictionariesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dictionariesTag,
  summary: 'Dictionary entries collection',
  pathParams: dictionaryIdParamsSchema,
  methods: {
    GET: dictionaryEntriesGetDoc,
    POST: dictionaryEntriesPostDoc,
  },
}
