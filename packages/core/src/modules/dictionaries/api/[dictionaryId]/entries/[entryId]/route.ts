import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { updateDictionaryEntrySchema } from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const paramsSchema = z.object({
  dictionaryId: z.string().uuid(),
  entryId: z.string().uuid(),
})

async function loadDictionary(context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>, id: string) {
  const dictionary = await context.em.findOne(Dictionary, {
    id,
    organizationId: context.organizationId,
    tenantId: context.tenantId,
    deletedAt: null,
  })
  if (!dictionary) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
  }
  return dictionary
}

async function loadEntry(
  context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>,
  dictionary: Dictionary,
  entryId: string,
) {
  const entry = await context.em.findOne(DictionaryEntry, {
    id: entryId,
    dictionary,
    organizationId: dictionary.organizationId,
    tenantId: context.tenantId,
  })
  if (!entry) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.entry_not_found', 'Dictionary entry not found') })
  }
  return entry
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
  PATCH: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

export async function PATCH(req: Request, ctx: { params?: { dictionaryId?: string; entryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId, entryId } = paramsSchema.parse({
      dictionaryId: ctx.params?.dictionaryId,
      entryId: ctx.params?.entryId,
    })
    const payload = updateDictionaryEntrySchema.parse(await req.json().catch(() => ({})))
    const dictionary = await loadDictionary(context, dictionaryId)
    const entry = await loadEntry(context, dictionary, entryId)

    if (payload.value !== undefined) {
      const value = payload.value.trim()
      if (!value) {
        throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.entry_required', 'Value is required') })
      }
      const normalized = value.toLowerCase()
      if (normalized !== entry.normalizedValue) {
        const duplicate = await context.em.findOne(DictionaryEntry, {
          dictionary,
          organizationId: dictionary.organizationId,
          tenantId: context.tenantId,
          normalizedValue: normalized,
          id: { $ne: entry.id } as any,
        })
        if (duplicate) {
          throw new CrudHttpError(409, { error: context.translate('dictionaries.errors.entry_duplicate', 'An entry with this value already exists') })
        }
        entry.value = value
        entry.normalizedValue = normalized
        if (payload.label === undefined) {
          entry.label = value
        }
      }
    }

    if (payload.label !== undefined) {
      const label = payload.label ? payload.label.trim() : ''
      entry.label = label || entry.value
    }

    if (payload.color !== undefined) {
      entry.color = normalizeColor(payload.color) ?? null
    }

    if (payload.icon !== undefined) {
      entry.icon = normalizeIcon(payload.icon) ?? null
    }

    entry.updatedAt = new Date()
    await context.em.flush()

    return NextResponse.json({
      id: entry.id,
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries/:entryId.PATCH] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to update dictionary entry' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { dictionaryId?: string; entryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId, entryId } = paramsSchema.parse({
      dictionaryId: ctx.params?.dictionaryId,
      entryId: ctx.params?.entryId,
    })
    const dictionary = await loadDictionary(context, dictionaryId)
    const entry = await loadEntry(context, dictionary, entryId)

    context.em.remove(entry)
    await context.em.flush()

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries/:entryId.DELETE] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to delete dictionary entry' }, { status: 500 })
  }
}
