import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandExecuteResult } from '@open-mercato/shared/lib/commands/types'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { CustomerDictionaryEntry, CustomerPipelineStage } from '../../../data/entities'
import { ensureDictionaryEntry } from '../../../commands/shared'
import { mapDictionaryKind, resolveDictionaryActorId, resolveDictionaryRouteContext } from '../context'
import { createDictionaryCacheKey, createDictionaryCacheTags, invalidateDictionaryCache, DICTIONARY_CACHE_TTL_MS } from '../cache'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { loadRoleTypeUsageMap, resolveRoleTypeUsageKey } from '../../../lib/roleTypeUsage'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

const colorSchema = z.string().trim().regex(/^#([0-9A-Fa-f]{6})$/, 'Invalid color hex')
const iconSchema = z.string().trim().min(1).max(48)

const postSchema = z.object({
  value: z.string().trim().min(1).max(150),
  label: z.string().trim().max(150).optional(),
  color: colorSchema.or(z.null()).optional(),
  icon: iconSchema.or(z.null()).optional(),
})

const querySchema = z.object({
  organizationId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
}

export async function GET(req: Request, ctx: { params?: { kind?: string } }) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse({
      organizationId: url.searchParams.get('organizationId') ?? undefined,
    })
    const { translate, em, organizationId, readableOrganizationIds, tenantId, cache } = await resolveDictionaryRouteContext(req, {
      selectedId: query.organizationId ?? undefined,
    })
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    }
    const scopedOrganizationIds = readableOrganizationIds.length > 0 ? readableOrganizationIds : [organizationId]
    const canUseCache = Boolean(cache) && mappedKind !== 'person_company_role'

    let cacheKey: string | null = null
    if (canUseCache && cache) {
      cacheKey = createDictionaryCacheKey({
        tenantId,
        organizationId,
        mappedKind,
        readableOrganizationIds: scopedOrganizationIds,
      })
      const cached = await cache.get(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const entries = await findWithDecryption(
      em,
      CustomerDictionaryEntry,
      { tenantId, kind: mappedKind, organizationId: { $in: scopedOrganizationIds } } as any,
      { orderBy: { label: 'asc' } },
      { tenantId, organizationId },
    )

    if (mappedKind === 'pipeline_stage' && organizationId) {
      const existingNormalized = new Set(entries.map((e) => e.normalizedValue))
      const pipelineStages = await findWithDecryption(em, CustomerPipelineStage, { organizationId, tenantId }, {}, { tenantId, organizationId })
      for (const stage of pipelineStages) {
        if (!existingNormalized.has(stage.label.trim().toLowerCase())) {
          const created = await ensureDictionaryEntry(em, {
            tenantId,
            organizationId,
            kind: 'pipeline_stage',
            value: stage.label,
          })
          if (created) {
            entries.push(created)
            existingNormalized.add(created.normalizedValue)
          }
        }
      }
    }

    const inheritedPriority = new Map(scopedOrganizationIds.map((id, index) => [id, index]))
    const sortByLabel = (left: CustomerDictionaryEntry, right: CustomerDictionaryEntry) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })

    const localEntries = entries
      .filter((entry) => entry.organizationId === organizationId)
      .sort(sortByLabel)
    const inheritedEntries = entries
      .filter((entry) => entry.organizationId !== organizationId)
      .sort((left, right) => {
        const leftPriority = inheritedPriority.get(left.organizationId) ?? Number.MAX_SAFE_INTEGER
        const rightPriority = inheritedPriority.get(right.organizationId) ?? Number.MAX_SAFE_INTEGER
        if (leftPriority !== rightPriority) return leftPriority - rightPriority
        return sortByLabel(left, right)
      })

    const preferredEntries = new Map<string, CustomerDictionaryEntry>()
    for (const entry of [...localEntries, ...inheritedEntries]) {
      const normalizedValue = entry.normalizedValue?.trim() || entry.value.trim().toLowerCase()
      if (!normalizedValue || preferredEntries.has(normalizedValue)) continue
      preferredEntries.set(normalizedValue, entry)
    }

    const preferredEntryList = Array.from(preferredEntries.values())
    const usageByEntryKey =
      mappedKind === 'person_company_role'
        ? await loadRoleTypeUsageMap(em, {
            tenantId,
            entries: preferredEntryList.map((entry) => ({
              organizationId: entry.organizationId,
              value: entry.value,
            })),
          })
        : new Map()

    const items = [
      ...preferredEntryList
        .filter((entry) => entry.organizationId === organizationId)
        .sort(sortByLabel)
        .map((entry) => ({
          id: entry.id,
          value: entry.value,
          label: entry.label,
          color: entry.color,
          icon: entry.icon,
          organizationId: entry.organizationId,
          isInherited: false,
          ...(mappedKind === 'person_company_role'
            ? {
                usageCount:
                  usageByEntryKey.get(resolveRoleTypeUsageKey(entry.organizationId, entry.value))?.total ?? 0,
              }
            : {}),
        })),
      ...preferredEntryList
        .filter((entry) => entry.organizationId !== organizationId)
        .sort(sortByLabel)
        .map((entry) => ({
          id: entry.id,
          value: entry.value,
          label: entry.label,
          color: entry.color,
          icon: entry.icon,
          organizationId: entry.organizationId,
          isInherited: true,
          ...(mappedKind === 'person_company_role'
            ? {
                usageCount:
                  usageByEntryKey.get(resolveRoleTypeUsageKey(entry.organizationId, entry.value))?.total ?? 0,
              }
            : {}),
        })),
    ]

    const responseBody = {
      items,
    }

    if (canUseCache && cache && cacheKey) {
      const tags = createDictionaryCacheTags({
        tenantId,
        mappedKind,
        organizationIds: scopedOrganizationIds,
      })
      try {
        await cache.set(cacheKey, responseBody, {
          ttl: DICTIONARY_CACHE_TTL_MS,
          tags,
        })
      } catch (err) {
        console.warn('[customers.dictionaries.cache] Failed to set cache entry', err)
      }
    }

    return NextResponse.json(responseBody)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.dictionaries.list failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to load dictionary entries') }, { status: 400 })
  }
}

export async function POST(req: Request, ctx: { params?: { kind?: string } }) {
  try {
    const context = await resolveDictionaryRouteContext(req)
    if (!context.organizationId) {
      throw new CrudHttpError(400, { error: context.translate('customers.errors.organization_required', 'Organization context is required') })
    }
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    const body = postSchema.parse(await readJsonSafe(req, {}))
    const guardUserId = resolveDictionaryActorId(context.auth)
    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: guardUserId,
      resourceKind: 'customers.dictionary_entry',
      resourceId: '',
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: body,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const commandBus = (context.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } =
      (await commandBus.execute('customers.dictionaryEntries.create', {
        input: {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
          kind: mappedKind,
          value: body.value,
          label: body.label,
          color: body.color,
          icon: body.icon,
        },
        ctx: context.ctx,
      })) as CommandExecuteResult<{ entryId: string; mode: 'created' | 'updated' | 'unchanged' }>
    const entry = await findOneWithDecryption(context.em.fork(), CustomerDictionaryEntry, result.entryId, {}, { tenantId: context.tenantId, organizationId: context.organizationId })
    if (!entry) {
      throw new CrudHttpError(400, { error: context.translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') })
    }

    await invalidateDictionaryCache(context.cache, {
      tenantId: context.tenantId,
      mappedKind,
      organizationIds: [entry.organizationId],
    })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: guardUserId,
        resourceKind: 'customers.dictionary_entry',
        resourceId: entry.id,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const response = NextResponse.json(
      {
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
        organizationId: entry.organizationId,
        isInherited: false,
      },
      { status: result.mode === 'created' ? 201 : 200 }
    )
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.dictionary_entry',
          resourceId: entry.id,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.dictionaries.create failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') }, { status: 400 })
  }
}

const dictionaryEntrySchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  isInherited: z.boolean().optional(),
})

const dictionaryListResponseSchema = z.object({
  items: z.array(dictionaryEntrySchema),
})

const dictionaryErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer dictionary entries',
  methods: {
    GET: {
      summary: 'List dictionary entries',
      description: 'Returns dictionary entries for the requested kind within the currently selected organization.',
      responses: [
        { status: 200, description: 'Dictionary entries', schema: dictionaryListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: dictionaryErrorSchema },
        { status: 400, description: 'Failed to resolve dictionary context', schema: dictionaryErrorSchema },
      ],
    },
    POST: {
      summary: 'Create or override dictionary entry',
      description: 'Creates a dictionary entry (or updates the existing entry for the same value) within the current organization scope.',
      requestBody: {
        contentType: 'application/json',
        schema: postSchema,
      },
      responses: [
        { status: 201, description: 'Dictionary entry created', schema: dictionaryEntrySchema },
        { status: 200, description: 'Dictionary entry updated', schema: dictionaryEntrySchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: dictionaryErrorSchema },
        { status: 401, description: 'Unauthorized', schema: dictionaryErrorSchema },
        { status: 409, description: 'Duplicate value conflict', schema: dictionaryErrorSchema },
      ],
    },
  },
}
