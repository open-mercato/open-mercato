import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  recordLockErrorSchema,
  recordLockSettingsConflictSchema,
  recordLockSettingsResponseSchema,
  recordLockSettingsUpsertSchema,
} from '../../data/validators'
import { resolveRecordLocksApiContext } from '../utils'

const RECORD_LOCK_SETTINGS_RESOURCE_KIND = 'record_locks.settings'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['record_locks.manage'] },
  POST: { requireAuth: true, requireFeatures: ['record_locks.manage'] },
}

export async function GET(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const { settings, updatedAt } = await ctxOrResponse.recordLockService.getSettingsRecord(ctxOrResponse.auth.tenantId)
  return NextResponse.json({ settings, updatedAt })
}

export async function POST(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const body = await req.json().catch(() => ({}))
  const parsed = recordLockSettingsUpsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid settings payload', details: parsed.error.issues }, { status: 400 })
  }

  const tenantId = ctxOrResponse.auth.tenantId
  try {
    const { settings, updatedAt } = await ctxOrResponse.recordLockService.saveSettingsRecord(parsed.data, tenantId, {
      assertCurrent: (currentUpdatedAt) => enforceCommandOptimisticLock({
        resourceKind: RECORD_LOCK_SETTINGS_RESOURCE_KIND,
        resourceId: tenantId,
        current: currentUpdatedAt,
        request: req,
      }),
    })
    return NextResponse.json({ settings, updatedAt })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Record Locks',
  summary: 'Record locking settings',
  methods: {
    GET: {
      summary: 'Get record locking settings',
      responses: [
        { status: 200, description: 'Current record locking settings', schema: recordLockSettingsResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: recordLockErrorSchema },
        { status: 403, description: 'Organization scope denied', schema: recordLockErrorSchema },
      ],
    },
    POST: {
      summary: 'Update record locking settings',
      requestBody: {
        contentType: 'application/json',
        schema: recordLockSettingsUpsertSchema,
      },
      responses: [
        { status: 200, description: 'Updated settings', schema: recordLockSettingsResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: recordLockErrorSchema },
        { status: 401, description: 'Unauthorized', schema: recordLockErrorSchema },
        { status: 403, description: 'Organization scope denied', schema: recordLockErrorSchema },
        { status: 409, description: 'Settings changed since they were loaded', schema: recordLockSettingsConflictSchema },
      ],
    },
  },
}
