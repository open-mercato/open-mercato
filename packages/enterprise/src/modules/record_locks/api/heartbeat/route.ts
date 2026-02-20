import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  recordLockErrorSchema,
  recordLockHeartbeatResponseSchema,
  recordLockHeartbeatSchema,
} from '../../data/validators'
import { resolveRecordLocksApiContext } from '../utils'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['record_locks.view'] },
}

export async function POST(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const body = await req.json().catch(() => ({}))
  const parsed = recordLockHeartbeatSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid heartbeat payload', details: parsed.error.issues }, { status: 400 })
  }

  const result = await ctxOrResponse.recordLockService.heartbeat({
    token: parsed.data.token,
    resourceKind: parsed.data.resourceKind,
    resourceId: parsed.data.resourceId,
    tenantId: ctxOrResponse.auth.tenantId,
    organizationId: ctxOrResponse.organizationId,
    userId: ctxOrResponse.auth.sub,
  })

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Record Locks',
  summary: 'Refresh record lock heartbeat',
  methods: {
    POST: {
      summary: 'Heartbeat active lock',
      requestBody: {
        contentType: 'application/json',
        schema: recordLockHeartbeatSchema,
      },
      responses: [
        { status: 200, description: 'Heartbeat accepted', schema: recordLockHeartbeatResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: recordLockErrorSchema },
        { status: 401, description: 'Unauthorized', schema: recordLockErrorSchema },
      ],
    },
  },
}
