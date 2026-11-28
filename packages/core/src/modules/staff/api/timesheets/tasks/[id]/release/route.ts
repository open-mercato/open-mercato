import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  TASK_ASSIGNMENT_VIEW_FEATURE,
  createTaskAssignmentPostHandler,
  taskAssignmentResponseSchema,
} from '../../../../../lib/time-tracking/taskAssignmentRoute'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [TASK_ASSIGNMENT_VIEW_FEATURE] },
}

export const POST = createTaskAssignmentPostHandler('release')

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Release a task you hold',
  methods: {
    POST: {
      summary: 'Release a task you hold',
      description: 'Clears the assignee of a task the caller is assigned to, making it claimable again; the project assigners are notified. Only the current assignee may release (403 otherwise); managers keep using PUT /api/staff/timesheets/tasks.',
      responses: [{ status: 200, description: 'Release a task you hold', schema: taskAssignmentResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'The caller is not the current assignee' },
        { status: 404, description: 'Task not found, or not on a project the caller can see' },
        { status: 409, description: 'The task changed since the version the caller sent, or it is no longer assigned to the caller (`task_assignment_changed`)' },
      ],
    },
  },
}
