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
  const lock = await enrichLockActor(em, (result as { lock?: LockWithActor | null }).lock ?? null)
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
