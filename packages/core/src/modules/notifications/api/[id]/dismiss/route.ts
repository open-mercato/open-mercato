import { createSingleNotificationActionRoute, createSingleNotificationActionOpenApi } from '../../../lib/routeHelpers'

export const metadata = {
  PUT: { requireAuth: true },
}

export const PUT = createSingleNotificationActionRoute('dismiss')

export const openApi = createSingleNotificationActionOpenApi(
  'Dismiss notification',
  'Notification dismissed'
)
