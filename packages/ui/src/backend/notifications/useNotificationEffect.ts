'use client'

import * as React from 'react'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { subscribeNotificationEffects } from './NotificationDispatcher'

export function useNotificationEffect(
  notificationType: string | string[],
  effect: (notification: NotificationDto) => void,
  deps: React.DependencyList = [],
) {
  React.useEffect(() => {
    const unsubscribe = subscribeNotificationEffects(notificationType, effect)
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationType, ...deps])
}
