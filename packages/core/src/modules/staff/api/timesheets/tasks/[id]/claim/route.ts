import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  TASK_ASSIGNMENT_VIEW_FEATURE,
  createTaskAssignmentPostHandler,
  taskAssignmentResponseSchema,
} from '../../../../../lib/time-tracking/taskAssignmentRoute'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [TASK_ASSIGNMENT_VIEW_FEATURE] },
}

export const POST = createTaskAssignmentPostHandler('claim')

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Claim an unassigned task',
  methods: {
    POST: {
      summary: 'Claim an unassigned task',
      description: 'Sets the caller as the assignee of an unassigned, not-done task. Only active assigners of the task project (a project member flagged as assigner, inside the assignment window) may claim; `staff.timesheets.tasks.manage` is not required. The update is conditional on the task still being unassigned, so of two concurrent claims exactly one wins and the other answers 409. Accepts `x-om-ext-optimistic-lock-expected-updated-at`.',
      responses: [{ status: 200, description: 'Claim an unassigned task', schema: taskAssignmentResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'The caller is not an active assigner of the project' },
        { status: 404, description: 'Task not found, or not on a project the caller can see' },
        { status: 409, description: 'The task was already claimed, or changed since the version the caller sent' },
        { status: 422, description: 'The task is in a done status' },
      ],
    },
  },
}
