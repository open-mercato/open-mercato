import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingContentBlock } from '../../data/entities.js'
import { contentBlockCreateSchema } from '../../data/validators.js'

/**
 * Reusable HTML blocks: list and create.
 *
 * **Hand-written rather than `makeCrudRoute`, deliberately.** The platform factory is the default for a plain
 * CRUD entity and brings listing, sorting and locking for free — but every other write in this module goes
 * through an explicit route with `enforceCommandOptimisticLock`, and two CRUD styles in one module is worse
 * for a reader than either style alone. Recorded in the spec as a candidate for conversion if the module ever
 * grows a second CRUD entity, at which point the factory earns its wiring.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const MAX_PAGE_SIZE = 100

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ items: [], total: 0 }, { status: 401 })

  const url = new URL(req.url)
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1)

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const [items, total] = await em.findAndCount(
    MarketingContentBlock,
    { ...scope, deletedAt: null },
    { orderBy: { key: 'ASC' }, limit: pageSize, offset: (page - 1) * pageSize },
  )

  return NextResponse.json({
    items: items.map((block) => ({
      id: block.id,
      key: block.key,
      name: block.name,
      html: block.html,
      // Every list row carries its version, so an edit form can send it back without a second read.
      updatedAt: block.updatedAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = contentBlockCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload', code: 'marketing_automation.validation.invalidPayload' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const block = em.create(MarketingContentBlock, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: parsed.data.key,
    name: parsed.data.name,
    html: parsed.data.html,
    deletedAt: null,
  })

  try {
    em.persist(block)
    await em.flush()
  } catch (error) {
    // The key is what authors type in a message, so a duplicate is a conflict worth naming rather than a 500.
    if (error instanceof UniqueConstraintViolationException) {
      return NextResponse.json(
        { error: `A block with the key "${parsed.data.key}" already exists`, code: 'marketing_automation.errors.blockKeyTaken' },
        { status: 409 },
      )
    }
    throw error
  }

  return NextResponse.json({ id: block.id, updatedAt: block.updatedAt.toISOString() })
}

export const openApi = {
  GET: {
    summary: 'List reusable content blocks',
    description: 'Named HTML fragments an author can reference from a message as `{{block:key}}`. Each row carries its version for an edit.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'A page of blocks' } },
  },
  POST: {
    summary: 'Create a content block',
    description: 'The key is slug-shaped so it cannot smuggle syntax into the reference it appears in. A duplicate key answers 409.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Created' }, 400: { description: 'Invalid payload' }, 409: { description: 'That key is taken' } },
  },
}
