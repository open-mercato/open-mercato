import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'

const logger = createLogger('catalog')

const DICTIONARY_ENTRY_ENTITY_TYPE = 'dictionaries:dictionary_entry'

type DictionaryEntryPayload = {
  id: string
  value: string
  label: string
  color: string | null
  icon: string | null
}

async function applyEntryTranslations(
  req: Request,
  entries: DictionaryEntryPayload[],
  context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>,
): Promise<DictionaryEntryPayload[]> {
  const { overlay, resolveLocale } = getTranslationOverlayPlugin()
  if (!overlay || !resolveLocale || entries.length === 0) return entries
  const locale = resolveLocale(req)
  if (!locale) return entries
  try {
    const translated = await overlay(entries, {
      entityType: DICTIONARY_ENTRY_ENTITY_TYPE,
      locale,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      container: context.container,
    })
    return translated.map((item, index) => ({
      ...entries[index],
      label: typeof item.label === 'string' && item.label.trim().length > 0 ? item.label : entries[index].label,
    }))
  } catch (err) {
    logger.warn('catalog.dictionaries.GET Translation overlay failed', { err })
    return entries
  }
}

const KEY_ALIASES: Record<string, string[]> = {
  currency: ['currency', 'currencies'],
  unit: ['unit', 'units', 'measurement_units'],
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
}

export async function GET(
  req: Request,
  ctx: { params?: { key?: string } },
): Promise<Response> {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const keyParam = (ctx.params?.key ?? '').toLowerCase().trim()
    if (!keyParam) {
      throw new CrudHttpError(400, { error: 'Dictionary key is required.' })
    }
    const keys = KEY_ALIASES[keyParam] ?? [keyParam]
    const dictionaries = await context.em.find(
      Dictionary,
      {
        tenantId: context.tenantId,
        key: { $in: keys },
        deletedAt: null,
        isActive: true,
      },
      { orderBy: { organizationId: 'asc', createdAt: 'asc' } },
    )
    const dictionary =
      dictionaries.find((entry) => entry.organizationId === context.organizationId) ??
      dictionaries[0] ??
      null
    if (!dictionary) {
      return NextResponse.json({ error: 'Dictionary not found.' }, { status: 404 })
    }
    const entries = await context.em.find(
      DictionaryEntry,
      {
        dictionary,
        organizationId: dictionary.organizationId,
        tenantId: dictionary.tenantId,
      },
      { orderBy: { label: 'asc' } },
    )
    const payload = entries.map((entry) => ({
      id: entry.id,
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
    return NextResponse.json({
      id: dictionary.id,
      entries: await applyEntryTranslations(req, payload, context),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('catalog.dictionaries.GET Unexpected error', { err })
    return NextResponse.json({ error: 'Failed to load dictionary.' }, { status: 500 })
  }
}

const dictionaryEntrySchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
})

const dictionaryResponseSchema = z.object({
  id: z.string().uuid(),
  entries: z.array(dictionaryEntrySchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog Dictionary lookup',
  methods: {
    GET: {
      summary: 'Get dictionary entries by key',
      description: 'Returns dictionary entries for a specific key (e.g., currency, unit).',
      responses: [
        {
          status: 200,
          description: 'Dictionary entries',
          schema: dictionaryResponseSchema,
        },
      ],
    },
  },
}
