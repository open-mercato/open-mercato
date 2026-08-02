'use client'

import { createElement, type ReactElement } from 'react'
import { useNotificationEffect } from '@open-mercato/ui/backend/notifications'
import type { NotificationDto, NotificationRendererProps, NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { notificationTypes } from './notifications'

function ReferenceNotificationRenderer(props: NotificationRendererProps): ReactElement {
  return createElement('div', { className: 'space-y-1' }, [
    createElement('p', { className: 'font-medium', key: 'title' }, props.notification.title),
    props.notification.body
      ? createElement('p', { className: 'text-sm text-muted-foreground', key: 'body' }, props.notification.body)
      : null,
  ])
}

export const referenceNotificationTypes: NotificationTypeDefinition[] = notificationTypes.map((definition) => ({
  ...definition,
  Renderer: ReferenceNotificationRenderer,
}))

export function useReferenceTaskNotificationEffect(
  onNotification: (notification: NotificationDto) => void,
): void {
  useNotificationEffect('reference_module.reference_task.status_changed', onNotification, [onNotification])
  useNotificationEffect('reference_module.import.completed', onNotification, [onNotification])
}

export default referenceNotificationTypes
