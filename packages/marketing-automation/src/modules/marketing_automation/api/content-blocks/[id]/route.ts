import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { MarketingContentBlock } from '../../../data/entities.js'
import { contentBlockUpdateSchema } from '../../../data/validators.js'
import { readPathUuid } from '../../shared.js'

/**
 * One content block: read, edit, remove.
 *
 * A block is SHARED — it is the footer of every campaign that references it — so a concurrent edit is not a
 * theoretical hazard here, it is the normal case. Every write carries the version the client read and
 * collides rather than overwriting.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  PUT: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

function readId(req: Request): string | null {
  return readPathUuid(req, 1)
}

async function load(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever. The
   * resolver also recovers the actor's own organization where that is still the actor's tenant, which is
   * what keeps a super-admin's own configuration visible instead of unreachable.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { error: organizationScopeRequiredResponse() }
  const id = readId(req)
  if (!id) return { error: NextResponse.json({ error: 'Missing id' }, { status: 400 }) }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }
  const block = await em.findOne(MarketingContentBlock, { id, ...scope, deletedAt: null })
  if (!block) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  // The container travels with the loaded record so the guarded lock seam can reach the optional enterprise
  // `record_locks` service through DI — the OSS floor alone would leave this module outside that guard.
  return { em, block, container }
}

export async function GET(req: Request) {
  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { block } = loaded
  return NextResponse.json({
    id: block.id,
    key: block.key,
    name: block.name,
    html: block.html,
    updatedAt: block.updatedAt.toISOString(),
  })
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = contentBlockUpdateSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload', code: 'marketing_automation.validation.invalidPayload' },
      { status: 400 },
    )
  }

  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { em, block, container } = loaded

  try {
    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: 'marketing_automation.content_block',
      resourceId: block.id,
      current: block.updatedAt,
      expected: parsed.data.updatedAt,
      request: req,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }

  // The KEY is deliberately not editable. Messages reference it by name, so renaming it would silently empty
  // the block out of every campaign that used it — a rename is a new block plus a deliberate edit of each
  // message, which is work an author should do knowingly.
  if (parsed.data.name !== undefined) block.name = parsed.data.name
  if (parsed.data.html !== undefined) block.html = parsed.data.html
  await em.flush()

  // The whole record, not just the new version: a client that keeps the block open needs the saved content
  // to compare against, and returning less makes the caller issue a GET to learn what it just wrote.
  return NextResponse.json({
    id: block.id,
    key: block.key,
    name: block.name,
    html: block.html,
    updatedAt: block.updatedAt.toISOString(),
  })
}

export async function DELETE(req: Request) {
  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { em, block, container } = loaded

  try {
    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: 'marketing_automation.content_block',
      resourceId: block.id,
      current: block.updatedAt,
      expected: undefined,
      request: req,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }

  // Soft-deleted: a message still referencing it renders nothing rather than breaking, and an operator can
  // see what was removed.
  block.deletedAt = new Date()
  await em.flush()
  return NextResponse.json({ ok: true })
}

export const openApi = {
  GET: { summary: 'Read a content block', tags: ['Marketing Automation'], responses: { 200: { description: 'The block' } } },
  PUT: {
    summary: 'Update a content block',
    description: 'Name and HTML only — the key is immutable, because every message referencing it would otherwise quietly render nothing. Requires the version the client read.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Updated' }, 409: { description: 'Changed since it was read' } },
  },
  DELETE: {
    summary: 'Remove a content block',
    description: 'Soft delete, so a message still referencing it renders nothing rather than failing.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Removed' } },
  },
}
