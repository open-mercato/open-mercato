import { createBatchNotificationSchema } from '../../data/validators'
import { createBulkNotificationRoute, createBulkNotificationOpenApi } from '../../lib/routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['notifications.create'] },
}

export const POST = createBulkNotificationRoute(createBatchNotificationSchema, 'createBatch')

export const openApi = createBulkNotificationOpenApi(
  createBatchNotificationSchema,
  'Create batch notifications',
  'Send the same notification to multiple users'
)
