import type { ApiInterceptor, InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { getStaffMemberByUserId } from '../lib/staffMemberResolver'

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
        { tenantId: context.tenantId ?? null, organizationId: context.organizationId ?? null },
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

      const staffMember = await getStaffMemberByUserId(
        context.em,
        context.userId,
        context.tenantId ?? null,
        context.organizationId ?? null,
      )

      if (!staffMember) {
        return {
          ok: false,
          statusCode: 403,
          message: 'User is not a staff member.',
        }
      }

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
            { field: 'staffMemberId', operator: 'eq', value: staffMember.id },
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

      const staffMember = await getStaffMemberByUserId(
        context.em,
        context.userId,
        context.tenantId ?? null,
        context.organizationId ?? null,
      )

      if (!staffMember) {
        return {
          ok: false,
          statusCode: 403,
          message: 'User is not a staff member.',
        }
      }

      return {
        ok: true,
        query: {
          ...(request.query ?? {}),
          staffMemberId: staffMember.id,
        },
      }
    },
  },
]
