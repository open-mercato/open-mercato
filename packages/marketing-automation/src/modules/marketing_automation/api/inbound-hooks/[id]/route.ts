import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { MarketingInboundHook } from '../../../data/entities.js'
import { inboundHookUpdateSchema } from '../../../data/validators.js'
import { readPathUuid } from '../../shared.js'

/**
 * One inbound hook: rename, revoke, restore, remove.
 *
 * Revoking is the important one and it is not a delete: the row keeps saying what the hook received and
 * when, which is the only record that an integration was ever live.
 */
const routeMetadata = {
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
  const hook = await em.findOne(MarketingInboundHook, {
    id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })
  if (!hook) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { em, hook }
}

export async function PUT(req: Request) {
  const parsed = inboundHookUpdateSchema.safeParse(await req.json().catch(() => null))
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

  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { em, hook } = loaded

  try {
    enforceCommandOptimisticLock({
      resourceKind: 'marketing_automation.inbound_hook',
      resourceId: hook.id,
      current: hook.updatedAt,
      expected: parsed.data.updatedAt,
      request: req,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }

  if (parsed.data.name !== undefined) hook.name = parsed.data.name
  if (parsed.data.revoked !== undefined) {
    // Restoring clears the timestamp rather than writing a second column: "when was it withdrawn" has one
    // answer at a time, and keeping a history of revocations would be a log, which this is not.
    hook.revokedAt = parsed.data.revoked ? (hook.revokedAt ?? new Date()) : null
  }
  await em.flush()

  return NextResponse.json({
    id: hook.id,
    name: hook.name,
    revokedAt: hook.revokedAt ? hook.revokedAt.toISOString() : null,
    updatedAt: hook.updatedAt.toISOString(),
  })
}

export async function DELETE(req: Request) {
  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { em, hook } = loaded

  try {
    enforceCommandOptimisticLock({
      resourceKind: 'marketing_automation.inbound_hook',
      resourceId: hook.id,
      current: hook.updatedAt,
      expected: undefined,
      request: req,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }

  hook.deletedAt = new Date()
  await em.flush()
  return NextResponse.json({ ok: true })
}

export const openApi = {
  PUT: {
    summary: 'Rename, revoke or restore an inbound hook',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The hook' }, 409: { description: 'Changed since it was read' } },
  },
  DELETE: {
    summary: 'Remove an inbound hook',
    description: 'Soft delete. Revoking is usually what is wanted, since it keeps the record of what the hook received.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Removed' } },
  },
}
