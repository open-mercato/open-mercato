import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { getStaffMemberByUserId } from '../lib/staffMemberResolver'

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

      const userFeatures = context.userFeatures ?? []
      if (userFeatures.includes('staff.timesheets.manage_all') || userFeatures.includes('staff.*')) {
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
]
