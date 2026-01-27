import { createRoleNotificationSchema } from '../../data/validators'
import { createBulkNotificationRoute, createBulkNotificationOpenApi } from '../../lib/routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['notifications.create'] },
}

export const POST = createBulkNotificationRoute(createRoleNotificationSchema, 'createForRole')

export const openApi = createBulkNotificationOpenApi(
  createRoleNotificationSchema,
  'Create notifications for all users in a role',
  'Send the same notification to all users who have the specified role within the organization'
)
