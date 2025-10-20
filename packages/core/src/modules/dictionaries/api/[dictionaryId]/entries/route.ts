import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { createDictionaryEntrySchema } from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const paramsSchema = z.object({ dictionaryId: z.string().uuid() })

async function loadDictionary(
  context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>,
  id: string,
  options: { allowInherited?: boolean } = {},
) {
  const { allowInherited = false } = options
  const dictionary = await context.em.findOne(Dictionary, {
    id,
    organizationId: allowInherited ? { $in: context.readableOrganizationIds } : context.organizationId,
    tenantId: context.tenantId,
    deletedAt: null,
  })
  if (!dictionary) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
  }
  return dictionary
}

function normalizeColor(color: string | null | undefined): string | null {
  if (!color) return null
  const trimmed = color.trim()
  if (!trimmed) return null
  const match = /^#([0-9a-fA-F]{6})$/.exec(trimmed)
  if (!match) return null
  return `#${match[1].toLowerCase()}`
}

function normalizeIcon(icon: string | null | undefined): string | null {
  if (!icon) return null
  const trimmed = icon.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 64)
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dictionaries.view'] },
  POST: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

export async function GET(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const dictionary = await loadDictionary(context, dictionaryId, { allowInherited: true })
    const entries = await context.em.find(
      DictionaryEntry,
      {
        dictionary,
        organizationId: dictionary.organizationId,
        tenantId: dictionary.tenantId,
      },
      { orderBy: { label: 'asc' } },
    )

    return NextResponse.json({
      items: entries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries.GET] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to load dictionary entries' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const dictionary = await loadDictionary(context, dictionaryId)
    const payload = createDictionaryEntrySchema.parse(await req.json().catch(() => ({})))
    const value = payload.value.trim()
    const normalized = value.toLowerCase()
    const label = payload.label?.trim() || value
    const color = normalizeColor(payload.color ?? null)
    const icon = normalizeIcon(payload.icon ?? null)

    const duplicate = await context.em.findOne(DictionaryEntry, {
      dictionary,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      normalizedValue: normalized,
    })
    if (duplicate) {
      throw new CrudHttpError(409, { error: context.translate('dictionaries.errors.entry_duplicate', 'An entry with this value already exists') })
    }

    const entry = context.em.create(DictionaryEntry, {
      dictionary,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      value,
      normalizedValue: normalized,
      label,
      color,
      icon,
    })
    context.em.persist(entry)
    await context.em.flush()

    return NextResponse.json({
      id: entry.id,
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }, { status: 201 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries.POST] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to create dictionary entry' }, { status: 500 })
  }
}
