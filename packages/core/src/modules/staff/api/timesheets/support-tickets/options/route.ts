/**
 * `GET /api/staff/timesheets/support-tickets/options` — the filter options behind
 * the Support Inbox.
 *
 * The inbox is open to every holder of `staff.timesheets.tasks.view`, so its option
 * lists cannot come from routes that need more: the routing preview needs
 * `staff.timesheets.settings.manage` and the team directory needs `staff.view`,
 * which an agent with the `employee` role holds neither of.
 *
 *  * `categories` is the organization's support category dictionary — the exact
 *    organization, never an inherited one, the same lookup the portal form and the
 *    ticket command use.
 *  * `assignees` is limited to the people the caller can already see through their
 *    project access: everyone actively assigned to one of the caller's projects, or,
 *    for a holder of `staff.timesheets.projects.manage`, every active staff member of
 *    the organization.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTeamMember, StaffTimeProjectMember } from '../../../../data/entities'
import { loadSupportTicketCategories } from '../../../../lib/support/dictionaries'
import { resolveFeatureAccess } from '../../../../lib/time-tracking/featureAccess'
import { MANAGE_PROJECTS_FEATURE, resolveProjectAccess } from '../../../../lib/time-tracking/access'
import {
  isActiveAssignment,
  normalizeAssignmentGraceDays,
  resolveAssignmentGraceDaysFromContainer,
} from '../../../../lib/time-tracking/projectAssignment'
import { readSearchParamsRecord, runTimesheetInterceptors } from '../../_shared/withTimesheetInterceptors'

const logger = createLogger('staff').child({ component: 'api/timesheets/support-tickets/options' })

const VIEW_FEATURE = 'staff.timesheets.tasks.view'
const MAX_ASSIGNEES = 500

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const optionsResponseSchema = z.object({
  categories: z.array(z.object({ value: z.string(), label: z.string() })),
  assignees: z.array(z.object({ id: z.string().uuid(), displayName: z.string() })),
})

type SupportInboxOptions = z.infer<typeof optionsResponseSchema>

type Scope = { tenantId: string; organizationId: string }

async function loadAssignableStaffMemberIds(
  em: EntityManager,
  scope: Scope,
  projectIds: string[],
  graceDays: number | null,
): Promise<string[]> {
  if (projectIds.length === 0) return []
  const memberships = await em.find(StaffTimeProjectMember, {
    timeProjectId: { $in: projectIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'active',
    deletedAt: null,
  })
  const now = new Date()
  return Array.from(
    new Set(
      memberships
        .filter((membership) => isActiveAssignment(membership, now, normalizeAssignmentGraceDays(graceDays)))
        .map((membership) => membership.staffMemberId),
    ),
  )
}

async function loadAssignees(
  em: EntityManager,
  scope: Scope,
  staffMemberIds: string[] | null,
): Promise<SupportInboxOptions['assignees']> {
  if (staffMemberIds !== null && staffMemberIds.length === 0) return []
  const where: Record<string, unknown> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    isActive: true,
    deletedAt: null,
  }
  if (staffMemberIds !== null) where.id = { $in: staffMemberIds }
  const members = await findWithDecryption(em, StaffTeamMember, where, { limit: MAX_ASSIGNEES }, scope)
  return members
    .map((member) => ({ id: member.id, displayName: member.displayName || member.id }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = orgScope?.tenantId ?? auth.tenantId ?? null
    const organizationId = resolveSingleOrganizationIdOrDeny(orgScope, auth) ?? null
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

    const scope: Scope = { tenantId, organizationId }
    const em = (container.resolve('em') as EntityManager).fork()
    const manageAccess = await resolveFeatureAccess(container, auth.sub ?? null, [MANAGE_PROJECTS_FEATURE], scope)
    const graceDays = await resolveAssignmentGraceDaysFromContainer(container, tenantId)
    const access = await resolveProjectAccess({
      em,
      userId: auth.sub ?? null,
      tenantId,
      organizationId,
      canManageAll: manageAccess.allowed,
      userFeatures: manageAccess.grantedFeatures,
      assignmentGraceDays: graceDays,
    })

    const assignableIds = access.canManageAll
      ? null
      : await loadAssignableStaffMemberIds(em, scope, access.projectIds, graceDays)

    const [categories, assignees] = await Promise.all([
      loadSupportTicketCategories(em, scope),
      loadAssignees(em.fork(), scope, assignableIds),
    ])

    const payload: SupportInboxOptions = optionsResponseSchema.parse({ categories, assignees })
    return session.respond(200, payload)
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('staff.support.inbox options failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.support_inbox_options_failed' })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('staff.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Support Inbox filter options',
  methods: {
    GET: {
      summary: 'Support Inbox filter options',
      description:
        "The organization's support ticket categories and the staff members a ticket can be filtered by assignee. Assignees are limited to the people actively assigned to the caller's projects; a holder of `staff.timesheets.projects.manage` gets every active staff member of the organization.",
      responses: [{ status: 200, description: 'Filter options', schema: optionsResponseSchema }],
      errors: [
        { status: 400, description: 'Missing tenant or organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.tasks.view' },
      ],
    },
  },
}
