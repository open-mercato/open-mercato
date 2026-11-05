'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { notificationTypes as serverNotificationTypes } from './notifications'
import IncomingChangesRenderer from './widgets/notifications/IncomingChangesRenderer'

export const recordLocksNotificationTypes: NotificationTypeDefinition[] = serverNotificationTypes.map((typeDef) => {
  if (typeDef.type !== 'record_locks.incoming_changes.available') return typeDef
  return {
    ...typeDef,
    Renderer: IncomingChangesRenderer,
  }
})

export default recordLocksNotificationTypes
