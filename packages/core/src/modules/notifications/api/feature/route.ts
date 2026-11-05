import { createFeatureNotificationSchema } from '../../data/validators'
import { createBulkNotificationRoute, createBulkNotificationOpenApi } from '../../lib/routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['notifications.create'] },
}

export const POST = createBulkNotificationRoute(createFeatureNotificationSchema, 'createForFeature')

export const openApi = createBulkNotificationOpenApi(
  createFeatureNotificationSchema,
  'Create notifications for all users with a specific feature/permission',
  'Send the same notification to all users who have the specified feature permission (via role ACL or user ACL). Supports wildcard matching.'
)
