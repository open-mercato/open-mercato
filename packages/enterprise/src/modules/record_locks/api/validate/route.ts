import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveRecordLocksApiContext } from '../utils'

const validateSchema = z.object({
  resourceKind: z.string().trim().min(1),
  resourceId: z.string().trim().min(1),
  method: z.enum(['PUT', 'DELETE']).default('PUT'),
  token: z.string().trim().min(1).optional(),
  baseLogId: z.string().uuid().optional(),
  conflictId: z.string().uuid().optional(),
  resolution: z.enum(['normal', 'accept_mine', 'merged']).default('normal'),
  mutationPayload: z.record(z.string(), z.unknown()).nullable().optional(),
})

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
    ? await em.find(User, { id: { $in: Array.from(userIds) }, deletedAt: null })
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

export async function POST(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const body = await req.json().catch(() => ({}))
  const parsed = validateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid validate payload', details: parsed.error.issues }, { status: 400 })
  }

  const result = await ctxOrResponse.recordLockService.validateMutation({
    tenantId: ctxOrResponse.auth.tenantId,
    organizationId: ctxOrResponse.organizationId,
    userId: ctxOrResponse.auth.sub,
    resourceKind: parsed.data.resourceKind,
    resourceId: parsed.data.resourceId,
    method: parsed.data.method,
    headers: {
      resourceKind: parsed.data.resourceKind,
      resourceId: parsed.data.resourceId,
      token: parsed.data.token,
      baseLogId: parsed.data.baseLogId,
      conflictId: parsed.data.conflictId,
      resolution: parsed.data.resolution,
    },
    mutationPayload: parsed.data.mutationPayload ?? null,
  })

  const em = ctxOrResponse.container.resolve<EntityManager>('em').fork()
  const lock = await redactPersonalData(em, (result as { lock?: LockPayload | null }).lock ?? null)
  return NextResponse.json({
    ...result,
    lock,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Record Locks',
  summary: 'Validate lock state before mutation',
  methods: {
    POST: {
      summary: 'Preflight lock validation for save/delete',
      requestBody: {
        contentType: 'application/json',
        schema: validateSchema,
      },
      responses: [
        { status: 200, description: 'Validation result' },
      ],
    },
  },
}
