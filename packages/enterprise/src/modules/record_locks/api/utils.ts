import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RecordLockService } from '../lib/recordLockService'

type RecordLocksAuth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>> & {
  sub: string
  tenantId: string
}

export type RecordLocksApiContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  auth: RecordLocksAuth
  organizationId: string | null
  recordLockService: RecordLockService
}

export async function resolveRecordLocksApiContext(req: Request): Promise<RecordLocksApiContext | Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const { organizationId } = await resolveFeatureCheckContext({
    container,
    auth,
    request: req,
  })

  const recordLockService = container.resolve<RecordLockService>('recordLockService')

  return {
    container,
    auth: auth as RecordLocksAuth,
    organizationId,
    recordLockService,
  }
}

export function jsonError(error: string, status = 400, extras?: Record<string, unknown>) {
  return NextResponse.json({ error, ...(extras ?? {}) }, { status })
}
