'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  NotificationRendererProps,
  NotificationTypeAction,
  NotificationTypeDefinition,
} from '@open-mercato/shared/modules/notifications/types'
import { notificationTypes as serverNotificationTypes } from './notifications'

export const ACTIONABLE_NOTIFICATION_TYPE = 'example.umes.actionable'

export type ActionableNotificationView = {
  isUnread: boolean
  primaryAction: NotificationTypeAction | null
  dismissAction: NotificationTypeAction | null
}

/**
 * Pure view resolution for {@link ExampleActionableRenderer}.
 *
 * Extracted so the renderer's only real decision — which declared action becomes the
 * primary button and which one dismisses — is testable without a DOM. Inlining it back
 * into the component would let a wrong action fire with every assertion still green.
 */
export function resolveActionableNotificationView(
  status: string,
  actions: readonly NotificationTypeAction[],
): ActionableNotificationView {
  const dismissAction = actions.find((action) => action.id === 'dismiss') ?? null
  const primaryAction = actions.find((action) => action.id !== dismissAction?.id) ?? null
  return {
    isUnread: status === 'unread',
    primaryAction,
    dismissAction,
  }
}

/**
 * Custom renderer for the `example.umes.actionable` notification.
 *
 * Production modules keep the component in `widgets/notifications/<Name>.tsx` and import
 * it here (see `packages/core/src/modules/inbox_ops/notifications.client.ts`). This
 * reference keeps the component inline, which is why it builds its markup with
 * `React.createElement` instead of JSX — the convention file is `.ts`, not `.tsx`.
 */
export function ExampleActionableRenderer({
  notification,
  onAction,
  onDismiss,
  actions = [],
}: NotificationRendererProps) {
  const t = useT()
  const [executing, setExecuting] = React.useState(false)
  const view = resolveActionableNotificationView(notification.status, actions)

  const runPrimary = React.useCallback(async () => {
    if (!view.primaryAction) return
    setExecuting(true)
    try {
      await onAction(view.primaryAction.id)
    } finally {
      setExecuting(false)
    }
  }, [onAction, view.primaryAction])

  return React.createElement(
    'div',
    { className: view.isUnread ? 'px-4 py-3 bg-status-info-bg' : 'px-4 py-3' },
    React.createElement('h4', { className: 'text-sm font-medium' }, notification.title),
    notification.body
      ? React.createElement('p', { className: 'mt-1 text-xs text-muted-foreground' }, notification.body)
      : null,
    React.createElement(
      'div',
      { className: 'mt-3 flex gap-2' },
      view.primaryAction
        ? React.createElement(
            Button,
            {
              key: view.primaryAction.id,
              variant: 'default',
              size: 'sm',
              disabled: executing,
              onClick: runPrimary,
            },
            t(view.primaryAction.labelKey),
          )
        : null,
      view.dismissAction
        ? React.createElement(
            Button,
            {
              key: view.dismissAction.id,
              variant: 'ghost',
              size: 'sm',
              onClick: () => { void onDismiss() },
            },
            t(view.dismissAction.labelKey),
          )
        : null,
    ),
  )
}

/**
 * Re-declares the SERVER notification types and attaches the renderer to the one this
 * module owns. Mapping over `notifications.ts` instead of restating the literals keeps
 * the frozen notification id, translation keys, actions, and expiry in one place.
 */
export const exampleNotificationTypes: NotificationTypeDefinition[] = serverNotificationTypes.map(
  (typeDef) => (
    typeDef.type === ACTIONABLE_NOTIFICATION_TYPE
      ? { ...typeDef, Renderer: ExampleActionableRenderer }
      : typeDef
  ),
)

export default exampleNotificationTypes
