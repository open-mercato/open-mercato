import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  recordLockAcquireResponseSchema,
  recordLockAcquireSchema,
  recordLockErrorSchema,
} from '../../data/validators'
import { resolveRecordLocksApiContext, resolveRequestIp } from '../utils'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type LockWithActor = {
  lockedByUserId: string
  lockedByName?: string | null
  lockedByEmail?: string | null
}

async function enrichLockActor(
  em: EntityManager,
  lock: LockWithActor | null | undefined,
): Promise<LockWithActor | null> {
  if (!lock) return null
  const actor = await em.findOne(User, { id: lock.lockedByUserId, deletedAt: null })
  return {
    ...lock,
    lockedByName: actor?.name ?? null,
    lockedByEmail: actor?.email ?? null,
  }
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['record_locks.view'] },
}

async function resolveCanForceRelease(
  ctx: Exclude<Awaited<ReturnType<typeof resolveRecordLocksApiContext>>, Response>,
): Promise<boolean> {
  try {
    const rbacService = ctx.container.resolve<RbacService>('rbacService')
    return await rbacService.userHasAllFeatures(
      ctx.auth.sub,
      ['record_locks.force_release'],
      {
        tenantId: ctx.auth.tenantId,
        organizationId: ctx.organizationId ?? null,
      },
    )
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const body = await req.json().catch(() => ({}))
  const parsed = recordLockAcquireSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid acquire payload', details: parsed.error.issues }, { status: 400 })
  }

  const result = await ctxOrResponse.recordLockService.acquire({
    resourceKind: parsed.data.resourceKind,
    resourceId: parsed.data.resourceId,
    tenantId: ctxOrResponse.auth.tenantId,
    organizationId: ctxOrResponse.organizationId,
    userId: ctxOrResponse.auth.sub,
    lockedByIp: resolveRequestIp(req),
  })

  const em = ctxOrResponse.container.resolve<EntityManager>('em').fork()
  const canForceRelease = result.allowForceUnlock
    ? await resolveCanForceRelease(ctxOrResponse)
    : false
  const allowForceUnlock = result.allowForceUnlock && canForceRelease

  if (!result.ok) {
    const lock = await enrichLockActor(em, result.lock as LockWithActor | null)
    return NextResponse.json(
      {
        error: result.error,
        code: result.code,
        allowForceUnlock,
        currentUserId: ctxOrResponse.auth.sub,
        lock,
      },
      { status: result.status },
    )
  }

  const lock = await enrichLockActor(em, result.lock as LockWithActor | null)
  return NextResponse.json({
    ...result,
    allowForceUnlock,
    currentUserId: ctxOrResponse.auth.sub,
    lock,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Record Locks',
  summary: 'Acquire record lock',
  methods: {
    POST: {
      summary: 'Acquire lock for editing',
      requestBody: {
        contentType: 'application/json',
        schema: recordLockAcquireSchema,
      },
      responses: [
        { status: 200, description: 'Lock acquisition result', schema: recordLockAcquireResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: recordLockErrorSchema },
        { status: 401, description: 'Unauthorized', schema: recordLockErrorSchema },
        { status: 423, description: 'Record locked by another user', schema: recordLockErrorSchema },
      ],
    },
  },
}
