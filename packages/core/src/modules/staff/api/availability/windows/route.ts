import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { PlannerAvailabilityRule, PlannerAvailabilityRuleSet } from '@open-mercato/core/modules/planner/data/entities'
import type { PlannerAvailabilityService } from '@open-mercato/core/modules/planner/services/plannerAvailabilityService'
import { StaffLeaveRequest, StaffTeamMember } from '../../../data/entities'
import { staffAvailabilityWindowsQuerySchema } from '../../../data/validators'
import {
  AVAILABILITY_WINDOW_DAY_MS,
  buildStaffAvailabilityWindows,
  mergeStaffAvailabilityWindows,
  staffAvailabilityWindowKinds,
} from '../../../lib/availabilityWindows'

const logger = createLogger('staff').child({ component: 'api/availability/windows' })
const CALENDAR_VIEW = 'customers.interactions.view'
const PLANNER_VIEW = 'planner.view'
const LEAVE_MANAGE = 'staff.leave_requests.manage'
const OWN_LEAVE_FEATURES = ['staff.my_leave_requests.view', 'staff.my_leave_requests.send', 'staff.leave_requests.send']

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [CALENDAR_VIEW] },
}

const windowsResponseSchema = z.object({
  items: z.array(z.object({
    userId: z.string().uuid(),
    organizationId: z.string().uuid(),
    windows: z.array(z.object({
      start: z.string().datetime(),
      end: z.string().datetime(),
      kind: z.enum(staffAvailabilityWindowKinds),
      reason: z.string().optional(),
    })),
  })),
})

type StaffWindowsItem = z.infer<typeof windowsResponseSchema>['items'][number]
type ScopedEntity = { organizationId: string }

function inOrganization(organizationId: string, id: string): string {
  return `${organizationId}:${id}`
}

function groupBySubject<T extends ScopedEntity>(records: T[], resolveSubjectId: (record: T) => string): Map<string, T[]> {
  const bySubject = new Map<string, T[]>()
  for (const record of records) {
    const key = inOrganization(record.organizationId, resolveSubjectId(record))
    const current = bySubject.get(key)
    if (current) current.push(record)
    else bySubject.set(key, [record])
  }
  return bySubject
}

export async function GET(request: Request, context?: { auth?: AuthContext }) {
  const { translate } = await resolveTranslations()
  const unauthorized = () => NextResponse.json({ error: translate('staff.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  const forbidden = () => NextResponse.json({ error: translate('staff.errors.forbidden', 'Forbidden') }, { status: 403 })
  const auth = context?.auth
  if (!auth?.sub || !auth.tenantId) return unauthorized()

  const parsed = staffAvailabilityWindowsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: translate('staff.errors.invalidInput', 'Invalid request') }, { status: 400 })
  }

  try {
    const { userIds, organizationId } = parsed.data
    const from = new Date(parsed.data.from)
    const to = new Date(parsed.data.to)
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const rbac = container.resolve<RbacService>('rbacService')
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    if (!scope.tenantId) return forbidden()
    const tenantId = scope.tenantId
    const scopedOrganizationIds = scope.filterIds ?? (scope.selectedId ? [scope.selectedId] : scope.allowedIds)
    if (organizationId && scopedOrganizationIds && !scopedOrganizationIds.includes(organizationId)) return forbidden()

    const candidateOrganizationIds = organizationId ? [organizationId] : scopedOrganizationIds
    if (candidateOrganizationIds?.length === 0) return NextResponse.json({ items: [] })
    const [organizations, calendarAccess] = await Promise.all([
      findWithDecryption(em, Organization, {
        tenant: tenantId,
        deletedAt: null,
        ...(candidateOrganizationIds ? { id: { $in: candidateOrganizationIds } } : {}),
      }, { fields: ['id', 'ancestorIds'] }, { tenantId }),
      rbac.resolveFeatureOrganizationAccess(auth.sub, [CALENDAR_VIEW], { tenantId }),
    ])
    const organizationIds = calendarAccess.filterOrganizationIds(organizations)
    if (organizationId && !organizationIds.includes(organizationId)) return forbidden()
    if (!organizationIds.length) return NextResponse.json({ items: [] })

    const permittedOrganizations = organizations.filter((organization) => organizationIds.includes(organization.id))
    const rowScope = { tenantId, organizationId: { $in: organizationIds }, deletedAt: null }
    const decryptScope = { tenantId, organizationId: organizationIds.length === 1 ? organizationIds[0] : null }
    const members = await findWithDecryption(em, StaffTeamMember, {
      ...rowScope,
      userId: { $in: userIds },
      isActive: true,
    }, { fields: ['id', 'organizationId', 'tenantId', 'userId', 'availabilityRuleSetId'] }, decryptScope)
    if (!members.length) return NextResponse.json({ items: [] })

    const memberIds = members.map((member) => member.id)
    const ruleSetIds = Array.from(new Set(members.flatMap((member) => member.availabilityRuleSetId ? [member.availabilityRuleSetId] : [])))
    const isOwnRequest = !auth.isApiKey && members.some((member) => member.userId === auth.sub)
    const checkReasonFeatures = async (features: string[]) => {
      const access = await Promise.all(features.map((feature) => rbac.resolveFeatureOrganizationAccess(auth.sub, [feature], { tenantId })))
      return new Set(access.flatMap((feature) => feature.filterOrganizationIds(permittedOrganizations)))
    }

    const [ruleSets, rules, leaves, plannerReasons, leaveReasons, ownLeaveReasons] = await Promise.all([
      ruleSetIds.length ? findWithDecryption(em, PlannerAvailabilityRuleSet, { ...rowScope, id: { $in: ruleSetIds } },
        { fields: ['id', 'organizationId', 'tenantId'] }, decryptScope) : [],
      findWithDecryption(em, PlannerAvailabilityRule, {
        ...rowScope,
        $or: [
          { subjectType: 'member', subjectId: { $in: memberIds } },
          ...(ruleSetIds.length ? [{ subjectType: 'ruleset' as const, subjectId: { $in: ruleSetIds } }] : []),
        ],
      }, { fields: ['id', 'organizationId', 'tenantId', 'subjectType', 'subjectId', 'kind', 'timezone', 'rrule', 'exdates',
        'note', 'unavailabilityReasonEntryId', 'unavailabilityReasonValue'] }, decryptScope),
      findWithDecryption(em, StaffLeaveRequest, {
        ...rowScope,
        member: { $in: memberIds },
        status: { $in: ['approved', 'pending'] },
        startDate: { $lte: new Date(to.getTime() + AVAILABILITY_WINDOW_DAY_MS) },
        endDate: { $gte: new Date(from.getTime() - 2 * AVAILABILITY_WINDOW_DAY_MS) },
      }, { fields: ['id', 'organizationId', 'tenantId', 'member', 'status', 'startDate', 'endDate', 'timezone',
        'note', 'unavailabilityReasonEntryId', 'unavailabilityReasonValue'] }, decryptScope),
      checkReasonFeatures([PLANNER_VIEW]),
      !auth.isApiKey ? checkReasonFeatures([LEAVE_MANAGE]) : new Set<string>(),
      isOwnRequest ? checkReasonFeatures(OWN_LEAVE_FEATURES) : new Set<string>(),
    ])

    const verifiedRuleSets = new Set(ruleSets.map((ruleSet) => inOrganization(ruleSet.organizationId, ruleSet.id)))
    const ruleSetsBySubject = groupBySubject(rules.filter((rule) => rule.subjectType === 'ruleset'), (rule) => rule.subjectId)
    const rulesByMember = groupBySubject(rules.filter((rule) => rule.subjectType === 'member'), (rule) => rule.subjectId)
    const leavesByMember = groupBySubject(leaves, (leave) => leave.member.id)
    const planner = container.resolve<PlannerAvailabilityService>('plannerAvailabilityService')
    const items: StaffWindowsItem[] = []

    for (const group of groupBySubject(members, (member) => member.userId ?? '').values()) {
      const [{ userId, organizationId: memberOrganizationId }] = group
      if (!userId) continue
      const scopedRuleSetIds = group.map((member) => member.availabilityRuleSetId
        ? inOrganization(member.organizationId, member.availabilityRuleSetId)
        : null)
      if (scopedRuleSetIds.some((ruleSetId) => ruleSetId && !verifiedRuleSets.has(ruleSetId))) continue
      const windows = group.flatMap((member, index) => {
        const ruleSetId = scopedRuleSetIds[index]
        const memberKey = inOrganization(memberOrganizationId, member.id)
        return buildStaffAvailabilityWindows({
          planner,
          range: { start: from, end: to },
          ruleSetRules: ruleSetId ? ruleSetsBySubject.get(ruleSetId) ?? [] : null,
          memberRules: rulesByMember.get(memberKey) ?? [],
          leaveRequests: leavesByMember.get(memberKey) ?? [],
          canReadPlannerReasons: plannerReasons.has(memberOrganizationId),
          canReadLeaveReasons: leaveReasons.has(memberOrganizationId)
            || (userId === auth.sub && ownLeaveReasons.has(memberOrganizationId)),
        })
      })
      items.push({ userId, organizationId: memberOrganizationId, windows: mergeStaffAvailabilityWindows(windows) })
    }
    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Failed to load staff availability windows', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'staff', code: 'staff.availability_windows_failed' })
    return NextResponse.json({ error: translate('staff.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Staff availability windows',
  methods: {
    GET: {
      summary: 'List unavailability for staff assigned to calendar events',
      description: 'Accepts up to 100 comma-separated user UUIDs and an increasing, zoned ISO date range of up to 93 days. Optional organizationId narrows the authorized scope. Pending leave is tentative, and reason text requires access to the source record.',
      query: staffAvailabilityWindowsQuerySchema,
      responses: [{ status: 200, description: 'Scoped staff availability windows', schema: windowsResponseSchema }],
      errors: [400, 401, 403, 500].map((status) => ({ status, description: 'Availability request failed', schema: z.object({ error: z.string() }) })),
    },
  },
}
