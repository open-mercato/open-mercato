import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { MarketingSegment } from '../../../data/entities.js'
import { segmentUpdateSchema } from '../../../data/validators.js'
import { isSelfReferentialSegment } from '../../../lib/engine/segment-expression.js'
import { readPathUuid } from '../../shared.js'

/**
 * One segment: read, edit, remove.
 *
 * The slug is not editable. Campaign audiences reference it, so a rename would silently empty every campaign
 * that targeted this segment — and unlike a broken campaign, nothing would report it.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  PUT: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

async function load(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = readPathUuid(req, 1)
  if (!id) return { error: NextResponse.json({ error: 'Missing id' }, { status: 400 }) }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const segment = await em.findOne(MarketingSegment, { id, ...scope, deletedAt: null })
  if (!segment) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { em, segment }
}

function present(segment: MarketingSegment) {
  return {
    id: segment.id,
    slug: segment.slug,
    name: segment.name,
    description: segment.description ?? null,
    expression: segment.expression ?? null,
    updatedAt: segment.updatedAt.toISOString(),
  }
}

export async function GET(req: Request) {
  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  return NextResponse.json(present(loaded.segment))
}

export async function PUT(req: Request) {
  const parsed = segmentUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }
  if (parsed.data.expression !== undefined && isSelfReferentialSegment(parsed.data.expression)) {
    return NextResponse.json(
      { error: 'A segment cannot be defined in terms of segments', code: 'marketing_automation.errors.segmentSelfReference' },
      { status: 400 },
    )
  }

  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { em, segment } = loaded

  try {
    enforceCommandOptimisticLock({
      resourceKind: 'marketing_automation.segment',
      resourceId: segment.id,
      current: segment.updatedAt,
      expected: parsed.data.updatedAt,
      request: req,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }

  if (parsed.data.name !== undefined) segment.name = parsed.data.name
  if (parsed.data.description !== undefined) segment.description = parsed.data.description
  if (parsed.data.expression !== undefined) {
    segment.expression = (parsed.data.expression ?? null) as Record<string, unknown> | null
  }
  await em.flush()

  return NextResponse.json(present(segment))
}

export async function DELETE(req: Request) {
  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { em, segment } = loaded

  try {
    enforceCommandOptimisticLock({
      resourceKind: 'marketing_automation.segment',
      resourceId: segment.id,
      current: segment.updatedAt,
      expected: undefined,
      request: req,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }

  /**
   * Soft-deleted, and a campaign still referencing the slug simply stops matching anybody.
   *
   * That is the honest behaviour: membership is computed from live definitions, so a deleted segment is an
   * empty one. Rewriting saved audiences to remove the reference would edit campaigns nobody asked us to edit.
   */
  segment.deletedAt = new Date()
  await em.flush()
  return NextResponse.json({ ok: true })
}

export const openApi = {
  GET: { summary: 'Read a segment', tags: ['Marketing Automation'], responses: { 200: { description: 'The segment' } } },
  PUT: {
    summary: 'Update a segment',
    description: 'Name, description and expression. The slug is immutable, because saved audiences reference it.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Updated' }, 409: { description: 'Changed since it was read' } },
  },
  DELETE: {
    summary: 'Remove a segment',
    description: 'Soft delete. A campaign still targeting the slug matches nobody, which is what a deleted segment means.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Removed' } },
  },
}
