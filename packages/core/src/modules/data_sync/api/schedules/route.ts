import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createSyncScheduleSchema, listSyncSchedulesQuerySchema } from '../../data/validators'
import type { SyncScheduleService } from '../../lib/sync-schedule-service'
import { serializeSchedule } from './serialize'
import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
  POST: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'List or create sync schedules',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listSyncSchedulesQuerySchema.safeParse({
    integrationId: url.searchParams.get('integrationId') ?? undefined,
    entityType: url.searchParams.get('entityType') ?? undefined,
    direction: url.searchParams.get('direction') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scheduleService = container.resolve('dataSyncScheduleService') as SyncScheduleService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }
  const { items, total } = await scheduleService.listSchedules(parsed.data, scope)

  return NextResponse.json({
    items: items.map(serializeSchedule),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await readJsonSafe(req)
  const parsed = createSyncScheduleSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const scheduleService = container.resolve('dataSyncScheduleService') as SyncScheduleService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: scope.organizationId,
    userId: auth.sub,
    resourceKind: 'data_sync.schedule',
    resourceId: scope.organizationId,
    operation: 'create',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  try {
    const schedule = await scheduleService.saveSchedule({
      ...parsed.data,
      expectedUpdatedAt: readOptimisticLockExpected(req),
    }, scope)

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: scope.organizationId,
        userId: auth.sub,
        resourceKind: 'data_sync.schedule',
        resourceId: schedule.id,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json(serializeSchedule(schedule), { status: 201 })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to save sync schedule'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
