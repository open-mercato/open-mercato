import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  recordLockErrorSchema,
  recordLockSettingsResponseSchema,
  recordLockSettingsUpsertSchema,
} from '../../data/validators'
import { resolveRecordLocksApiContext } from '../utils'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['record_locks.manage'] },
  POST: { requireAuth: true, requireFeatures: ['record_locks.manage'] },
}

export async function GET(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const settings = await ctxOrResponse.recordLockService.getSettings()
  return NextResponse.json({ settings })
}

export async function POST(req: Request) {
  const ctxOrResponse = await resolveRecordLocksApiContext(req)
  if (ctxOrResponse instanceof Response) return ctxOrResponse

  const body = await req.json().catch(() => ({}))
  const parsed = recordLockSettingsUpsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid settings payload', details: parsed.error.issues }, { status: 400 })
  }

  const settings = await ctxOrResponse.recordLockService.saveSettings(parsed.data)
  return NextResponse.json({ settings })
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
      ],
    },
  },
}
