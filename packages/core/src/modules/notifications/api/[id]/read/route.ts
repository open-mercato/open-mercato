import { createSingleNotificationActionRoute, createSingleNotificationActionOpenApi } from '../../../lib/routeHelpers'

export const metadata = {
  PUT: { requireAuth: true },
}

export const PUT = createSingleNotificationActionRoute('markAsRead')

export const openApi = createSingleNotificationActionOpenApi(
  'Mark notification as read',
  'Notification marked as read'
)
