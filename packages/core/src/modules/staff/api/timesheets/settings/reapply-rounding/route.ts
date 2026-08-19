/**
 * `POST /api/staff/timesheets/settings/reapply-rounding` — screen 16 note 3 (T7.3).
 *
 * The mockup draws retroactive rounding as a switch. It is implemented as an
 * **action**, because the two are not the same promise: a switch that rewrites
 * `rounded_minutes` across a tenant's history when the settings form is saved
 * changes invoiced amounts as a side effect of an unrelated save. This endpoint
 * makes it something a person does, once, on purpose, with a progress bar and a
 * final count.
 *
 * It enqueues; it does not do the work. Restating a tenant's entries is exactly the
 * long-running job the progress module exists for, so the response is a `202` with
 * a `progressJobId` that the top bar picks up on its own.
 *
 * Locked entries are never touched — the candidate query excludes them and the
 * command excludes them again, independently.
 */

import { NextResponse } from 'next/server'
import { resolveFeatureAccess } from '../../../../lib/time-tracking/featureAccess'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ProgressService } from '../../../../../progress/lib/progressService'
import {
  STAFF_TIME_REAPPLY_ROUNDING_JOB_TYPE,
  STAFF_TIME_REAPPLY_ROUNDING_QUEUE,
  countReapplyRoundingCandidates,
  getStaffQueue,
  type ReapplyRoundingScope,
} from '../../../../lib/time-tracking/reapplyRounding'

const logger = createLogger('staff').child({ component: 'api/timesheets/settings/reapply-rounding' })

const MANAGE_FEATURE = 'staff.timesheets.settings.manage'
const RESOURCE_KIND = 'staff.timesheets.settings'
const RESOURCE_ID = 'time_tracking'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
}

const responseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  /** Entries eligible for restatement — locked ones are not among them. */
  candidateCount: z.number().int(),
})

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    }

    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = organizationScope?.tenantId ?? auth.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const actorId = typeof auth.sub === 'string' && auth.sub.trim().length > 0 ? auth.sub : 'system'
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null

    let grantedFeatures: string[] | null = null
    try {
      const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
      grantedFeatures = rbac?.getGrantedFeatures
        ? await rbac.getGrantedFeatures(actorId, { tenantId, organizationId })
        : null
    } catch {
      grantedFeatures = null
    }
    // Checked unconditionally. The `grantedFeatures &&` this replaces turned the
    // check off whenever the grant read failed — harmless here only because the
    // route metadata happens to require the same feature, which is exactly the
    // shape that leaked rates on the report routes where no such backstop existed.
    if (!(await resolveFeatureAccess(container, actorId, [MANAGE_FEATURE], { tenantId, organizationId })).allowed) {
      throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))
    }

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        userId: actorId,
        tenantId,
        organizationId,
        userFeatures: grantedFeatures ?? undefined,
      },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: RESOURCE_ID,
        operation: 'update',
        mutationPayload: { action: 'reapply-rounding' },
      },
    })
    if (!guardResult.ok) return guardResult.response

    const scope: ReapplyRoundingScope = {
      tenantId,
      // `filterIds === null` means the caller may act across every organization of
      // the tenant, which is what a tenant-global rule is about; anything narrower
      // restates only what the caller can already see.
      organizationIds: organizationScope?.filterIds ?? (organizationId ? [organizationId] : null),
      userId: actorId,
    }

    const em = container.resolve('em') as EntityManager
    const candidateCount = await countReapplyRoundingCandidates(em.fork(), scope)
    if (candidateCount === 0) {
      // Nothing to restate: no job, no progress bar, no queue traffic. The caller
      // gets an honest zero rather than a job that completes instantly.
      await guardResult.runAfterSuccess()
      return NextResponse.json(
        responseSchema.parse({ ok: true, progressJobId: null, candidateCount: 0 }),
        { status: 200 },
      )
    }

    const progressService = container.resolve('progressService') as ProgressService
    const progressJob = await progressService.createJob(
      {
        jobType: STAFF_TIME_REAPPLY_ROUNDING_JOB_TYPE,
        name: translate('staff.time_tracking.settings.retro.jobName', 'Reapply rounding to existing entries'),
        description: translate(
          'staff.time_tracking.settings.retro.jobDescription',
          'Recomputing rounded time on existing entries. Locked entries are not changed.',
        ),
        totalCount: candidateCount,
        cancellable: true,
        meta: { source: 'staff.timesheets.settings.reapply-rounding' },
      },
      { tenantId, organizationId, userId: actorId },
    )

    const queue = getStaffQueue(STAFF_TIME_REAPPLY_ROUNDING_QUEUE)
    await queue.enqueue({ progressJobId: progressJob.id, scope })

    await guardResult.runAfterSuccess()

    return NextResponse.json(
      responseSchema.parse({ ok: true, progressJobId: progressJob.id, candidateCount }),
      { status: 202 },
    )
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('staff.timesheets.settings.reapply-rounding failed', { err })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Reapply the rounding rule to existing entries',
  methods: {
    POST: {
      summary: 'Queue a retroactive rounding job',
      description:
        'Enqueues a `ProgressJob` that recomputes `rounded_minutes` on existing time entries under the tenant’s current rounding rule. Entries locked into a closed report are excluded — a billed amount is never restated. Returns `202` with `progressJobId`, or `200` with a null job id when there is nothing to restate.',
      responses: [
        { status: 200, description: 'Nothing to restate', schema: responseSchema },
        { status: 202, description: 'Job queued', schema: responseSchema },
        { status: 400, description: 'Missing scope', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Missing staff.timesheets.settings.manage' },
        { status: 500, description: 'Queueing failure', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
