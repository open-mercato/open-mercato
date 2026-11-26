import type { ApiInterceptor, InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { getStaffMembersByUserId } from '../lib/staffMemberResolver'

type RbacServiceLike = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

/**
 * Checks whether the caller has manage_all rights, honoring wildcard ACL grants
 * (`staff.*`, `*`) and the super-admin flag.
 *
 * `context.userFeatures` is populated only on CRUD-factory routes (factory.ts
 * calls `rbacService.getGrantedFeatures`). Custom routes that wire interceptors
 * manually (like `dashboards/widgets/data`) pass `auth.features` directly, and
 * the JWT does NOT include features — so we must fall back to loading the ACL
 * from `rbacService.userHasAllFeatures`, which is cached and wildcard-aware.
 */
async function hasManageAllFeature(context: InterceptorContext): Promise<boolean> {
  try {
    const rbac = context.container.resolve('rbacService') as RbacServiceLike | undefined
    if (rbac?.userHasAllFeatures) {
      return await rbac.userHasAllFeatures(
        context.userId,
        ['staff.timesheets.manage_all'],
        { tenantId: context.tenantId || null, organizationId: context.organizationId || null },
      )
    }
  } catch {
    // Fall back to the already-loaded snapshot below.
  }
  return authorizeFeatures(
    ['staff.timesheets.manage_all'],
    { grantedFeatures: context.userFeatures ?? [] },
  )
}

const NOT_STAFF_MEMBER_MESSAGE = 'User is not a staff member.'
const AMBIGUOUS_STAFF_MEMBER_MESSAGE = 'Select a single organization to view your own time entries.'

/**
 * Self-scope narrowing for callers without `staff.timesheets.manage_all`.
 *
 * A user can be staff in several organizations of one tenant, one
 * `StaffTeamMember` row each, and every lookup below is bound to the trusted
 * tenant. The time-entries list answers for one organization (the selected one,
 * else the caller's home organization), so it is narrowed to the caller's staff
 * member in that organization. With no organization in scope a user with several
 * memberships is refused rather than narrowed to an arbitrary one of them.
 * Dashboard widget data aggregates over every organization the request may read,
 * so it is narrowed to the set of all the caller's own staff members in the
 * tenant; the widget service bounds that set to the readable organizations.
 */
export const interceptors: ApiInterceptor[] = [
  {
    id: 'staff.timesheets.self-scope-widget-data',
    targetRoute: 'dashboards/widgets/data',
    methods: ['POST'],
    priority: 70,
    async before(request, context) {
      const entityType = request.body?.entityType
      if (entityType !== 'staff:staff_time_entries') {
        return { ok: true }
      }

      if (await hasManageAllFeature(context)) {
        return { ok: true }
      }

      const staffMembers = await getStaffMembersByUserId(
        context.em,
        context.userId,
        context.tenantId || null,
        null,
      )

      if (staffMembers.length === 0) {
        return {
          ok: false,
          statusCode: 403,
          message: NOT_STAFF_MEMBER_MESSAGE,
        }
      }

      const ownStaffMemberFilter = staffMembers.length === 1
        ? { field: 'staffMemberId', operator: 'eq', value: staffMembers[0].id }
        : { field: 'staffMemberId', operator: 'in', value: staffMembers.map((member) => member.id) }

      const existingFilters = Array.isArray(request.body?.filters) ? request.body.filters : []
      const otherFilters = existingFilters.filter(
        (f: Record<string, unknown>) => f.field !== 'staffMemberId',
      )

      return {
        ok: true,
        body: {
          ...request.body,
          filters: [
            ...otherFilters,
            ownStaffMemberFilter,
          ],
        },
      }
    },
  },
  {
    id: 'staff.timesheets.self-scope-time-entries',
    targetRoute: 'staff/timesheets/time-entries',
    methods: ['GET'],
    priority: 70,
    async before(request, context) {
      if (await hasManageAllFeature(context)) {
        return { ok: true }
      }

      const staffMembers = await getStaffMembersByUserId(
        context.em,
        context.userId,
        context.tenantId || null,
        context.organizationId || null,
      )

      if (staffMembers.length === 0) {
        return {
          ok: false,
          statusCode: 403,
          message: NOT_STAFF_MEMBER_MESSAGE,
        }
      }

      if (staffMembers.length > 1) {
        return {
          ok: false,
          statusCode: 403,
          message: AMBIGUOUS_STAFF_MEMBER_MESSAGE,
        }
      }

      return {
        ok: true,
        query: {
          ...(request.query ?? {}),
          staffMemberId: staffMembers[0].id,
        },
      }
    },
  },
]
