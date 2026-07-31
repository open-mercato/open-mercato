import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeEntry, StaffTimeEntrySegment } from '../../../../../data/entities'
import { getStaffMemberByUserId } from '../../../../../lib/staffMemberResolver'
import {
  resolveUserFeatures,
  runStaffMutationGuardAfterSuccess,
  runStaffMutationGuards,
} from '../../../../guards'
import { emitStaffEvent } from '../../../../../events'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

function extractEntryIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-entries\/([^/]+)\/timer-start/)
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

    const staffMember = await getStaffMemberByUserId(em, auth.sub, tenantId, organizationId)
    if (!staffMember || entry.staffMemberId !== staffMember.id) {
      throw new CrudHttpError(403, { error: translate('staff.timesheets.errors.notOwner', 'You can only manage your own time entries.') })
    }

    if (entry.startedAt) {
      return NextResponse.json(
        { error: translate('staff.timesheets.errors.timerAlreadyStarted', 'Timer is already started for this entry.') },
        { status: 409 },
      )
    }

    const guardResult = await runStaffMutationGuards(
      container,
      {
        tenantId,
        organizationId,
        userId: auth.sub ?? '',
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: entry.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
      },
      resolveUserFeatures(auth),
    )
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    // Start the timer inside a single transaction with a PESSIMISTIC_WRITE lock
    // on the time entry row, re-checking startedAt under the lock so two
    // concurrent timer-start calls on the same entry cannot both create an
    // initial work segment (issue #2416).
    const now = await em.transactional(async (trx) => {
      const lockedEntry = await findOneWithDecryption(
        trx,
        StaffTimeEntry,
        { id: entryId, tenantId, organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scopeCtx,
      )
      if (!lockedEntry) {
        throw new CrudHttpError(404, { error: translate('staff.timesheets.errors.entryNotFound', 'Time entry not found.') })
      }
      if (lockedEntry.startedAt) {
        throw new CrudHttpError(409, {
          error: translate('staff.timesheets.errors.timerAlreadyStarted', 'Timer is already started for this entry.'),
        })
      }

      // Single-active-timer invariant (issue #2855): reject the start when the
      // staff member already has another running entry (started_at set,
      // ended_at null). Without this guard a second surface (dashboard widget,
      // another tab) could create and start a parallel timer, leaving two
      // concurrent running entries and the "stopped timer comes back running"
      // symptom reported in #2456.
      const otherRunningEntry = await findOneWithDecryption(
        trx,
        StaffTimeEntry,
        {
          tenantId,
          organizationId,
          staffMemberId: lockedEntry.staffMemberId,
          id: { $ne: lockedEntry.id },
          startedAt: { $ne: null },
          endedAt: null,
          deletedAt: null,
        },
        {},
        scopeCtx,
      )
      if (otherRunningEntry) {
        throw new CrudHttpError(409, {
          error: translate(
            'staff.timesheets.errors.timerAlreadyRunning',
            'Another timer is already running. Stop it before starting a new one.',
          ),
        })
      }

      const startedAt = new Date()
      lockedEntry.startedAt = startedAt
      lockedEntry.source = 'timer'

      const segmentData = {
        tenantId,
        organizationId,
        timeEntryId: lockedEntry.id,
        startedAt,
        segmentType: 'work' as const,
      }
      trx.create(StaffTimeEntrySegment, segmentData as never)

      await trx.flush()
      return startedAt
    })

    void emitStaffEvent('staff.timesheets.time_entry.timer_started', {
      id: entry.id,
      staffMemberId: entry.staffMemberId,
      tenantId: entry.tenantId,
      organizationId: entry.organizationId,
      startedAt: now.toISOString(),
    }, { persistent: true }).catch((err) => {
      logger.error('staff.timesheets emit timer_started failed', { err })
    })

    if (guardResult.afterSuccessCallbacks.length) {
      await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
        tenantId,
        organizationId,
        userId: auth.sub ?? '',
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: entry.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('staff.timesheets.time-entries.timer-start failed', { err })
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
        { status: 409, description: 'Timer already started, or another timer is already running for this staff member', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
