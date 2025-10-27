import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandExecuteResult } from '@open-mercato/shared/lib/commands/types'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { CustomerDictionaryEntry } from '../../../data/entities'
import { mapDictionaryKind, resolveDictionaryRouteContext } from '../context'
import { createDictionaryCacheKey, createDictionaryCacheTags, invalidateDictionaryCache, DICTIONARY_CACHE_TTL_MS } from '../cache'
import { z } from 'zod'

const colorSchema = z.string().trim().regex(/^#([0-9A-Fa-f]{6})$/, 'Invalid color hex')
const iconSchema = z.string().trim().min(1).max(48)

const postSchema = z.object({
  value: z.string().trim().min(1).max(150),
  label: z.string().trim().max(150).optional(),
  color: colorSchema.or(z.null()).optional(),
  icon: iconSchema.or(z.null()).optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
}

export async function GET(req: Request, ctx: { params?: { kind?: string } }) {
  try {
    const { translate, em, organizationId, tenantId, readableOrganizationIds, cache } = await resolveDictionaryRouteContext(req)
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)

    let cacheKey: string | null = null
    if (cache) {
      cacheKey = createDictionaryCacheKey({ tenantId, organizationId, mappedKind, readableOrganizationIds })
      const cached = await cache.get(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const organizationOrder = new Map<string, number>()
    readableOrganizationIds.forEach((id, index) => organizationOrder.set(id, index))

    const entries = await em.find(
      CustomerDictionaryEntry,
      { tenantId, organizationId: { $in: readableOrganizationIds }, kind: mappedKind } as any,
      { orderBy: { label: 'asc' } }
    )

    const byValue = new Map<string, { entry: CustomerDictionaryEntry; isInherited: boolean; order: number }>()
    for (const entry of entries) {
      const normalized = entry.normalizedValue
      const order = organizationOrder.get(entry.organizationId) ?? Number.MAX_SAFE_INTEGER
      if (!byValue.has(normalized) || order < byValue.get(normalized)!.order) {
        byValue.set(normalized, {
          entry,
          isInherited: entry.organizationId !== organizationId,
          order,
        })
      }
    }

    const items = Array.from(byValue.values()).map(({ entry, isInherited, order }) => ({
      id: entry.id,
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
      organizationId: entry.organizationId,
      isInherited,
      __order: order,
    }))

    items.sort((a, b) => {
      if (a.isInherited !== b.isInherited) return a.isInherited ? 1 : -1
      if (a.__order !== b.__order) return a.__order - b.__order
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    })

    const responseBody = {
      items: items.map(({ __order, ...item }) => item),
    }

    if (cache && cacheKey) {
      const tags = createDictionaryCacheTags({
        tenantId,
        mappedKind,
        organizationIds: readableOrganizationIds,
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
    if (err instanceof CrudHttpError) {
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
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    const body = postSchema.parse(await req.json().catch(() => ({})))
    const commandBus = context.container.resolve<CommandBus>('commandBus')
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
    const entry = await context.em.fork().findOne(CustomerDictionaryEntry, result.entryId)
    if (!entry) {
      throw new CrudHttpError(400, { error: context.translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') })
    }

    await invalidateDictionaryCache(context.cache, {
      tenantId: context.tenantId,
      mappedKind,
      organizationIds: [entry.organizationId],
    })

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
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.dictionaries.create failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') }, { status: 400 })
  }
}
