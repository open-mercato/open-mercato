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

type LockPayload = {
  lockedByUserId?: string
  lockedByIp?: string | null
  lockedByName?: string | null
  lockedByEmail?: string | null
  participants?: Array<{
    userId: string
    lockedByIp?: string | null
    lockedByName?: string | null
    lockedByEmail?: string | null
    lockedAt: string
    lastHeartbeatAt: string
    expiresAt: string
  }>
  activeParticipantCount?: number
}

function maskEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  const atIndex = normalized.indexOf('@')
  if (atIndex <= 0 || atIndex === normalized.length - 1) return null
  const local = normalized.slice(0, atIndex)
  const domain = normalized.slice(atIndex + 1)
  const dotIndex = domain.indexOf('.')
  if (dotIndex <= 0 || dotIndex === domain.length - 1) return null
  const domainName = domain.slice(0, dotIndex)
  const domainSuffix = domain.slice(dotIndex)
  const localPrefix = local.slice(0, Math.min(2, local.length))
  const domainPrefix = domainName.slice(0, Math.min(4, domainName.length))
  return `${localPrefix}**@${domainPrefix}**${domainSuffix}`
}

async function redactPersonalData(
  em: EntityManager,
  lock: LockPayload | null | undefined,
  scope: { tenantId: string; organizationId: string | null },
): Promise<LockPayload | null> {
  if (!lock) return null
  const userIds = new Set<string>()
  if (typeof lock.lockedByUserId === 'string' && lock.lockedByUserId.trim().length > 0) {
    userIds.add(lock.lockedByUserId)
  }
  for (const participant of lock.participants ?? []) {
    if (typeof participant.userId === 'string' && participant.userId.trim().length > 0) {
      userIds.add(participant.userId)
    }
  }

  const users = userIds.size
    ? await em.find(User, {
      id: { $in: Array.from(userIds) },
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    : []
  const userById = new Map(users.map((user) => [user.id, user]))

  const participants = (lock.participants ?? []).map((participant) => {
    const { lockedByIp, lockedByName, lockedByEmail, ...rest } = participant
    const maskedEmail = maskEmail(userById.get(participant.userId)?.email ?? null)
    return {
      ...rest,
      ...(maskedEmail ? { lockedByEmail: maskedEmail } : {}),
    }
  })

  const { lockedByIp, lockedByName, lockedByEmail, lockedByUserId, ...rest } = lock
  const maskedOwnerEmail = maskEmail(
    lockedByUserId ? (userById.get(lockedByUserId)?.email ?? null) : null,
  )
  return {
    ...rest,
    lockedByIp: null,
    lockedByName: null,
    lockedByEmail: maskedOwnerEmail,
    participants,
    activeParticipantCount: lock.activeParticipantCount ?? participants.length,
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
    const lock = await redactPersonalData(em, result.lock as LockPayload | null, {
      tenantId: ctxOrResponse.auth.tenantId,
      organizationId: ctxOrResponse.organizationId ?? null,
    })
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

  const lock = await redactPersonalData(em, result.lock as LockPayload | null, {
    tenantId: ctxOrResponse.auth.tenantId,
    organizationId: ctxOrResponse.organizationId ?? null,
  })
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
