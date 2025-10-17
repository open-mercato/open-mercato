import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDictionaryEntry } from '../../../data/entities'
import { ensureDictionaryEntry } from '../../../commands/shared'

const paramsSchema = z.object({
  kind: z.enum(['statuses', 'sources']),
})

const postSchema = z.object({
  value: z.string().trim().min(1).max(150),
  label: z.string().trim().max(150).optional(),
})

const KIND_MAP: Record<'statuses' | 'sources', 'status' | 'source'> = {
  statuses: 'status',
  sources: 'source',
}

type RouteContext = {
  auth: Awaited<ReturnType<typeof getAuthFromRequest>>
  translate: (key: string, fallback?: string) => string
  em: EntityManager
  organizationId: string
  tenantId: string
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
  }

  const em = container.resolve<EntityManager>('em')
  return {
    auth,
    translate,
    em,
    organizationId,
    tenantId: auth.tenantId,
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export async function GET(req: Request, ctx: { params?: { kind?: string } }) {
  try {
    const { translate, em, organizationId, tenantId } = await resolveRouteContext(req)
    const { kind } = paramsSchema.parse({ kind: ctx.params?.kind })
    const mappedKind = KIND_MAP[kind]

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
    const context = await resolveRouteContext(req)
    const { kind } = paramsSchema.parse({ kind: ctx.params?.kind })
    const mappedKind = KIND_MAP[kind]
    const body = postSchema.parse(await req.json().catch(() => ({})))
    const value = body.value.trim()
    const normalized = value.toLowerCase()

    const existing = await context.em.findOne(CustomerDictionaryEntry, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      kind: mappedKind,
      normalizedValue: normalized,
    })
    if (existing) {
      return NextResponse.json(
        { id: existing.id, value: existing.value, label: existing.label },
        { status: 200 }
      )
    }

    const entry = await ensureDictionaryEntry(context.em, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      kind: mappedKind,
      value,
      label: body.label ?? value,
    })
    await context.em.flush()

    if (!entry) {
      throw new CrudHttpError(400, { error: context.translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') })
    }

    return NextResponse.json(
      { id: entry.id, value: entry.value, label: entry.label },
      { status: 201 }
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
