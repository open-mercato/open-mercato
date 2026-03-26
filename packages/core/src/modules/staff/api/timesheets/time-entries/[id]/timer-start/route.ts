import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeEntry, StaffTimeEntrySegment } from '../../../../../data/entities'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
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

    const entry = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      { id: params.id, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )
    if (!entry) {
      throw new CrudHttpError(404, { error: translate('staff.timesheets.errors.entryNotFound', 'Time entry not found.') })
    }

    if (entry.startedAt) {
      return NextResponse.json(
        { error: translate('staff.timesheets.errors.timerAlreadyStarted', 'Timer is already started for this entry.') },
        { status: 409 },
      )
    }

    const now = new Date()
    entry.startedAt = now
    entry.source = 'timer'

    em.create(StaffTimeEntrySegment, {
      tenantId,
      organizationId,
      timeEntryId: entry.id,
      startedAt: now,
      segmentType: 'work',
    })

    await em.flush()

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('staff.timesheets.time-entries.timer-start failed', err)
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.timerStart', 'Failed to start timer.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Start timer for a time entry',
  methods: {
    POST: {
      summary: 'Start timer for a time entry',
      description: 'Starts the timer on a time entry by setting startedAt and creating an initial work segment.',
      responses: [
        { status: 200, description: 'Timer started', schema: z.object({ ok: z.literal(true) }) },
        { status: 404, description: 'Time entry not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Timer already started', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
