import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  recordLockErrorSchema,
  recordLockForceReleaseResponseSchema,
  recordLockForceReleaseSchema,
} from '../../data/validators'
import { resolveRecordLocksApiContext } from '../utils'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['record_locks.force_release'] },
}

export async function POST(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const body = await req.json().catch(() => ({}))
  const parsed = recordLockForceReleaseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid force-release payload', details: parsed.error.issues }, { status: 400 })
  }

  const result = await ctxOrResponse.recordLockService.forceRelease({
    resourceKind: parsed.data.resourceKind,
    resourceId: parsed.data.resourceId,
    reason: parsed.data.reason,
    tenantId: ctxOrResponse.auth.tenantId,
    organizationId: ctxOrResponse.organizationId,
    userId: ctxOrResponse.auth.sub,
  })

  if (!result.released) {
    return NextResponse.json({ error: 'Force release is disabled or no active lock found' }, { status: 409 })
  }

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Record Locks',
  summary: 'Force release record lock',
  methods: {
    POST: {
      summary: 'Force release lock owned by another user',
      requestBody: {
        contentType: 'application/json',
        schema: recordLockForceReleaseSchema,
      },
      responses: [
        { status: 200, description: 'Force release result', schema: recordLockForceReleaseResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: recordLockErrorSchema },
        { status: 401, description: 'Unauthorized', schema: recordLockErrorSchema },
        { status: 403, description: 'Missing permission', schema: recordLockErrorSchema },
        { status: 409, description: 'No releasable lock', schema: recordLockErrorSchema },
      ],
    },
  },
}
