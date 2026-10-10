/**
 * `GET /api/staff/timesheets/capacity` — the target the timesheet footer, the
 * per-day load bars and the default expanded day are measured against (EP-40).
 *
 * The target used to be computed in the browser as `working days × dailyHours`,
 * which no contributed capacity provider could ever influence. This route asks the
 * `timeCapacityResolver` instead, so a provider that knows contract hours or
 * approved leave answers for the period and person on screen.
 *
 * Access:
 *
 *  * Without `staffMemberId` the target is the CALLER's own.
 *  * Another person's target requires `staff.timesheets.projects.manage` — the same
 *    grant the timesheet's person filter is offered under. A contributed target can
 *    encode contract hours, which is HR data, not something every viewer may read.
 *  * The staff member must belong to the caller's tenant and organization.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTeamMember } from '../../../data/entities'
import { MANAGE_PROJECTS_FEATURE } from '../../../lib/time-tracking/access'
import { resolveFeatureAccess } from '../../../lib/time-tracking/featureAccess'
import { readTimeTrackingSettings } from '../../../lib/time-tracking/settings'
import { buildCapacityDateRange, resolveCapacityForRange } from '../../../lib/time-tracking/capacityService'
import { parseIsoDay } from '../../../lib/time-tracking-ui/timesheetPeriod'
import {
  readSearchParamsRecord,
  runTimesheetInterceptors,
} from '../_shared/withTimesheetInterceptors'

const logger = createLogger('staff').child({ component: 'api/timesheets/capacity' })

const VIEW_FEATURE = 'staff.timesheets.view'
const MAX_RANGE_DAYS = 366
const DAY_MS = 24 * 60 * 60 * 1000

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const isoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => parseIsoDay(value) !== null)

const querySchema = z
  .object({
    from: isoDaySchema,
    to: isoDaySchema,
    staffMemberId: z.string().uuid().optional(),
  })
  .refine((query) => query.from <= query.to, { path: ['to'] })
  .refine(
    (query) => {
      const from = parseIsoDay(query.from)
      const to = parseIsoDay(query.to)
      return !from || !to || Math.round((to.getTime() - from.getTime()) / DAY_MS) < MAX_RANGE_DAYS
    },
    { path: ['to'] },
  )

const responseSchema = z.object({
  staffMemberId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  workingDays: z.number().int(),
  dailyHours: z.number().nullable(),
  providerId: z.string(),
  isBuiltIn: z.boolean(),
  label: z.string().nullable(),
  labelKey: z.string().nullable(),
  targetMinutesByDate: z.record(z.string(), z.number()),
  totalTargetMinutes: z.number().nullable(),
})

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'GET',
      scope: { container, userId: auth.sub, tenantId, organizationId },
      query: readSearchParamsRecord(req.url),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const parsed = querySchema.safeParse(session.query)
    if (!parsed.success) {
      throw new CrudHttpError(400, {
        error: translate('staff.timesheets.errors.invalidCapacityQuery', 'Invalid capacity period.'),
      })
    }
    const query = parsed.data

    const em = (container.resolve('em') as EntityManager).fork()
    const scopeCtx = { tenantId, organizationId }
    const ownMember = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { userId: auth.sub, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )

    let staffMemberId = ownMember?.id ?? null
    if (query.staffMemberId && query.staffMemberId !== ownMember?.id) {
      const access = await resolveFeatureAccess(container, auth.sub ?? null, [MANAGE_PROJECTS_FEATURE], scopeCtx)
      if (!access.allowed) {
        throw new CrudHttpError(403, {
          error: translate('staff.timesheets.errors.capacityForbidden', 'You cannot view this person’s target.'),
        })
      }
      const member = await findOneWithDecryption(
        em,
        StaffTeamMember,
        { id: query.staffMemberId, tenantId, organizationId, deletedAt: null },
        {},
        scopeCtx,
      )
      if (!member) {
        throw new CrudHttpError(404, {
          error: translate('staff.timesheets.errors.staffMemberNotFound', 'Staff member not found or not accessible.'),
        })
      }
      staffMemberId = member.id
    }
    if (!staffMemberId) {
      throw new CrudHttpError(403, {
        error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.'),
      })
    }

    let dailyHours: number | null = null
    try {
      const configService = container.resolve('moduleConfigService') as ModuleConfigService
      dailyHours = (await readTimeTrackingSettings(configService, { tenantId })).targets.dailyHours
    } catch (err) {
      logger.warn('staff.timesheets.capacity settings read failed; resolving without a daily target', { err })
    }

    const range = { from: query.from, to: query.to }
    const capacity = await resolveCapacityForRange({
      container,
      staffMemberId,
      range,
      tenantId,
      organizationId,
      dailyHours,
    })

    return session.respond(200, {
      staffMemberId,
      from: range.from,
      to: range.to,
      workingDays: buildCapacityDateRange(range).workingDays.length,
      dailyHours,
      providerId: capacity.providerId,
      isBuiltIn: capacity.isBuiltIn,
      label: capacity.label ?? null,
      labelKey: capacity.labelKey ?? null,
      targetMinutesByDate: capacity.targetMinutesByDate,
      totalTargetMinutes: capacity.totalTargetMinutes,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('staff.timesheets.capacity failed', { err })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.capacity', 'Failed to load the target.') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Timesheet capacity target',
  methods: {
    GET: {
      summary: 'Resolve the time target for a person and period',
      description:
        'Resolves the target minutes for the period through the EP-40 capacity provider registry (`timeCapacityResolver`). Defaults to the caller; another staff member requires staff.timesheets.projects.manage.',
      query: z.object({
        from: z.string().describe('yyyy-mm-dd, inclusive'),
        to: z.string().describe('yyyy-mm-dd, inclusive'),
        staffMemberId: z.string().uuid().optional(),
      }),
      responses: [{ status: 200, description: 'Resolved target', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid period or missing scope', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'No staff profile, or another person without permission', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Staff member not found', schema: z.object({ error: z.string() }) },
        { status: 500, description: 'Target could not be resolved', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
