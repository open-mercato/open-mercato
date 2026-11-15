'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { notificationTypes } from './notifications'
import { TimeProjectAccessRequestedRenderer } from './widgets/notifications/TimeProjectAccessRequestedRenderer'

const rendererMap: Record<string, NotificationTypeDefinition['Renderer']> = {
  'staff.timesheets.project_access.requested': TimeProjectAccessRequestedRenderer,
}

export const staffNotificationTypes: NotificationTypeDefinition[] = notificationTypes.map((type) => ({
  ...type,
  Renderer: rendererMap[type.type],
}))

export default staffNotificationTypes
