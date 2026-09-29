import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingSegment } from '../../data/entities.js'
import { segmentCreateSchema } from '../../data/validators.js'
import { isSelfReferentialSegment, isValidSegmentSlug, slugifySegmentName } from '../../lib/engine/segment-expression.js'

/**
 * Saved segments: list and create.
 *
 * A segment is a named audience expression and nothing more — the same condition tree a campaign uses, stored
 * so several campaigns can share it and so a person can be told which segments they are in.
 *
 * The list deliberately carries NO member counts. Counting a segment means resolving its membership, which is
 * a scan for any expression the database cannot narrow; doing that for twenty segments to render one screen
 * would make the screen the most expensive page in the module. Size is asked for one segment at a time.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const MAX_PAGE_SIZE = 100

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
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ items: [], total: 0 }, { status: 401 })

  const url = new URL(req.url)
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50, 1), MAX_PAGE_SIZE)

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const [items, total] = await em.findAndCount(
    MarketingSegment,
    { ...scope, deletedAt: null },
    { orderBy: { name: 'ASC' }, limit: pageSize },
  )
  return NextResponse.json({ items: items.map(present), total })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = segmentCreateSchema.safeParse(await req.json().catch(() => null))
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

  // A segment defined in terms of segments would evaluate against a key that is still being computed, so it
  // is refused at the writer rather than guarded at every reader.
  if (isSelfReferentialSegment(parsed.data.expression)) {
    return NextResponse.json(
      { error: 'A segment cannot be defined in terms of segments', code: 'marketing_automation.errors.segmentSelfReference' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  /**
   * The slug is derived once, here, and never changes again.
   *
   * Saved audiences reference it, so renaming it would silently empty every campaign that targeted the
   * segment — the same reasoning as a content block's key. A collision gets a numeric suffix rather than an
   * error, because two segments called "VIP" is a naming problem, not a failure.
   */
  const base = slugifySegmentName(parsed.data.name)
  let slug = base
  let stillTaken = false
  for (let attempt = 2; attempt <= 50; attempt += 1) {
    const taken = await em.findOne(MarketingSegment, { ...scope, slug, deletedAt: null })
    if (!taken) {
      stillTaken = false
      break
    }
    stillTaken = true
    /**
     * Room for the suffix is made by trimming the BASE, not by trimming the result.
     *
     * `\`${base}-${attempt}\`.slice(0, 64)` returns the base unchanged once the base is already 64 characters,
     * so a second segment whose name shares a 64-character prefix ran fifty pointless lookups and then inserted
     * the slug that was taken — a 500 from the unique index, also reachable by double-clicking submit.
     */
    const suffix = `-${attempt}`
    slug = `${base.slice(0, 64 - suffix.length)}${suffix}`
  }
  if (stillTaken) {
    // Fifty variations of one name is a naming problem the author has to resolve, and saying so beats a 500.
    return NextResponse.json(
      {
        error: 'Too many segments share this name — please give it a more distinct one',
        code: 'marketing_automation.errors.segmentSlug',
      },
      { status: 400 },
    )
  }
  if (!isValidSegmentSlug(slug)) {
    return NextResponse.json(
      { error: 'The name does not produce a usable reference', code: 'marketing_automation.errors.segmentSlug' },
      { status: 400 },
    )
  }

  const segment = em.create(MarketingSegment, {
    ...scope,
    slug,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    expression: (parsed.data.expression ?? null) as Record<string, unknown> | null,
  })
  em.persist(segment)
  await em.flush()

  return NextResponse.json(present(segment))
}

export const openApi = {
  GET: {
    summary: 'List saved segments',
    description: 'Definitions only. Sizes are asked for one segment at a time, because counting a segment the database cannot narrow is a scan.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Segments' } },
  },
  POST: {
    summary: 'Create a segment',
    description: 'The slug is derived from the name and immutable afterwards, because saved audiences reference it. A segment may not be defined in terms of segments.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The segment' }, 400: { description: 'Invalid, or self-referential' } },
  },
}
