import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  recordLockErrorSchema,
  recordLockReleaseResponseSchema,
  recordLockReleaseSchema,
} from '../../data/validators'
import { resolveRecordLocksApiContext } from '../utils'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['record_locks.view'] },
}

export async function POST(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const body = await req.json().catch(() => ({}))
  const parsed = recordLockReleaseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid release payload', details: parsed.error.issues }, { status: 400 })
  }

  const result = await ctxOrResponse.recordLockService.release({
    token: parsed.data.token,
    resourceKind: parsed.data.resourceKind,
    resourceId: parsed.data.resourceId,
    reason: parsed.data.reason,
    tenantId: ctxOrResponse.auth.tenantId,
    organizationId: ctxOrResponse.organizationId,
    userId: ctxOrResponse.auth.sub,
  })

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Record Locks',
  summary: 'Release record lock',
  methods: {
    POST: {
      summary: 'Release active lock owned by the caller',
      requestBody: {
        contentType: 'application/json',
        schema: recordLockReleaseSchema,
      },
      responses: [
        { status: 200, description: 'Release result', schema: recordLockReleaseResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: recordLockErrorSchema },
        { status: 401, description: 'Unauthorized', schema: recordLockErrorSchema },
      ],
    },
  },
}
