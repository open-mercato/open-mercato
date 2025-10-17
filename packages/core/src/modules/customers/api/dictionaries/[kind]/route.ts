import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDictionaryEntry } from '../../../data/entities'
import { ensureDictionaryEntry } from '../../../commands/shared'
import { mapDictionaryKind, resolveDictionaryRouteContext } from '../context'
import { z } from 'zod'

const colorSchema = z.string().trim().regex(/^#([0-9A-Fa-f]{6})$/, 'Invalid color hex')
const iconSchema = z.string().trim().min(1).max(48)

const postSchema = z.object({
  value: z.string().trim().min(1).max(150),
  label: z.string().trim().max(150).optional(),
  color: colorSchema.optional(),
  icon: iconSchema.optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
}

export async function GET(req: Request, ctx: { params?: { kind?: string } }) {
  try {
    const { translate, em, organizationId, tenantId } = await resolveDictionaryRouteContext(req)
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)

    const entries = await em.find(
      CustomerDictionaryEntry,
      { tenantId, organizationId, kind: mappedKind },
      { orderBy: { label: 'asc' } }
    )

    return NextResponse.json({
      items: entries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
      })),
    })
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
    const value = body.value.trim()
    const normalized = value.toLowerCase()

    const existing = await context.em.findOne(CustomerDictionaryEntry, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      kind: mappedKind,
      normalizedValue: normalized,
    })

    const entry = await ensureDictionaryEntry(context.em, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      kind: mappedKind,
      value,
      label: body.label ?? value,
      color: body.color,
      icon: body.icon,
    })
    let hasChanges = false
    if (existing && body.label !== undefined && entry.label !== body.label) {
      entry.label = body.label
      hasChanges = true
    }
    if (hasChanges) {
      entry.updatedAt = new Date()
    }
    await context.em.flush()

    if (!entry) {
      throw new CrudHttpError(400, { error: context.translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') })
    }

    return NextResponse.json(
      { id: entry.id, value: entry.value, label: entry.label, color: entry.color, icon: entry.icon },
      { status: existing ? 200 : 201 }
    )
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.dictionaries.create failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') }, { status: 400 })
  }
}
