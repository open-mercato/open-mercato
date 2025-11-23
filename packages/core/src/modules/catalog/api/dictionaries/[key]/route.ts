import { NextResponse } from 'next/server'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

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
    return NextResponse.json({
      id: dictionary.id,
      entries: entries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color ?? null,
        icon: entry.icon ?? null,
      })),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[catalog.dictionaries.GET] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to load dictionary.' }, { status: 500 })
  }
}
