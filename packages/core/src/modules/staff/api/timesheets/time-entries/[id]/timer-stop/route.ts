import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeEntry, StaffTimeEntrySegment } from '../../../../../data/entities'

function extractEntryIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-entries\/([^/]+)\/timer-stop/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const scopeCtx = { tenantId, organizationId }

    const entryId = extractEntryIdFromUrl(req)
    if (!entryId) {
      throw new CrudHttpError(400, { error: translate('staff.timesheets.errors.missingEntryId', 'Missing entry ID.') })
    }

    const entry = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      { id: entryId, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )
    if (!entry) {
      throw new CrudHttpError(404, { error: translate('staff.timesheets.errors.entryNotFound', 'Time entry not found.') })
    }

    const segments = await findWithDecryption(
      em,
      StaffTimeEntrySegment,
      { timeEntryId: entry.id, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )

    const activeSegment = segments.find((segment) => !segment.endedAt)
    if (!activeSegment) {
      return NextResponse.json(
        { error: translate('staff.timesheets.errors.noActiveSegment', 'No active timer segment found for this entry.') },
        { status: 409 },
      )
    }

    const now = new Date()
    activeSegment.endedAt = now
    entry.endedAt = now

    const allSegments = segments.map((segment) => {
      if (segment.id === activeSegment.id) {
        return { ...segment, endedAt: now }
      }
      return segment
    })

    const totalWorkMinutes = allSegments
      .filter((segment) => segment.segmentType === 'work' && segment.startedAt && segment.endedAt)
      .reduce((sum, segment) => {
        const startMs = new Date(segment.startedAt).getTime()
        const endMs = new Date(segment.endedAt!).getTime()
        return sum + (endMs - startMs)
      }, 0)

    const durationMinutes = Math.round(totalWorkMinutes / 60000)
    entry.durationMinutes = durationMinutes

    await em.flush()

    return NextResponse.json({ ok: true, durationMinutes }, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('staff.timesheets.time-entries.timer-stop failed', err)
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.timerStop', 'Failed to stop timer.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Stop timer for a time entry',
  methods: {
    POST: {
      summary: 'Stop timer for a time entry',
      description: 'Stops the active timer segment, recalculates total work duration in minutes, and updates the time entry.',
      responses: [
        {
          status: 200,
          description: 'Timer stopped',
          schema: z.object({ ok: z.literal(true), durationMinutes: z.number() }),
        },
        { status: 404, description: 'Time entry not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'No active timer segment', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
