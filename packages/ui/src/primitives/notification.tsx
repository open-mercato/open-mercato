"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  type AlertStatus,
  type AlertStyle,
} from './alert'

export type NotificationProps = {
  /**
   * Notification status. Same five values as `Alert`.
   * Default `'information'`.
   */
  status?: AlertStatus
  /**
   * Visual style. Same four values as `Alert`.
   * Default `'light'`.
   */
  style?: AlertStyle
  /**
   * Avatar/icon override. If provided, replaces the per-status default
   * Lucide icon — typical for user-driven notifications ("John
   * commented on..." with the author avatar). Pass an `Avatar`
   * primitive instance or any 20×20 visual.
   */
  avatar?: React.ReactNode
  /**
   * Notification title. Rendered as `AlertTitle` (Label/Small,
   * `font-medium 14/20`).
   */
  title?: React.ReactNode
  /**
   * Notification body. Rendered as `AlertDescription` at 72% opacity
   * per Figma `170:1839` reference (Paragraph/Small, `font-regular
   * 14/20`).
   */
  description?: React.ReactNode
  /**
   * Right-aligned timestamp hint next to the title (e.g. `"2 min
   * ago"`). Pre-formatted by the caller — pass through
   * `formatRelativeTime()` from `@open-mercato/shared/lib/time` for
   * the standard look.
   */
  timestamp?: React.ReactNode
  /**
   * Action buttons / links rendered under the description. Pass a
   * `<>...</>` fragment or an array of action elements. Separators
   * are not auto-inserted — wrap your actions in a `<div>` with
   * `gap-2` if you need custom spacing.
   */
  actions?: React.ReactNode
  /** Render the trailing X close button. Defaults to `true` — Figma reference always shows it. */
  dismissible?: boolean
  onDismiss?: () => void
  dismissAriaLabel?: string
  className?: string
  /** Stable id used by the `NotificationStack` (or external trackers) to identify the card. Forwarded as `data-notification-id`. */
  id?: string
}

/**
 * Card composition over the `Alert` primitive matching the Figma
 * Notification reference (`170:1839` — Error/Light/Large). Renders a
 * status icon (or custom `avatar`), a title + timestamp row, an
 * `opacity-72` description, and an optional row of action links. Use
 * with `NotificationStack` for corner-floating manual-dismiss UX, or
 * standalone inside a panel / dialog content area.
 *
 * Notification is intentionally a thin wrapper — every visual token
 * comes from the `Alert` primitive so the look stays in sync with the
 * unified Alert / Notification / Toast design.
 */
export const Notification = React.forwardRef<HTMLDivElement, NotificationProps>(
  (
    {
      status,
      style,
      avatar,
      title,
      description,
      timestamp,
      actions,
      dismissible = true,
      onDismiss,
      dismissAriaLabel,
      className,
      id,
    },
    ref,
  ) => {
    return (
      <Alert
        ref={ref}
        status={status}
        style={style}
        size="default"
        icon={avatar}
        dismissible={dismissible}
        onDismiss={onDismiss}
        dismissAriaLabel={dismissAriaLabel}
        className={className}
        data-slot="notification"
        data-notification-id={id}
      >
        {(title || timestamp) && (
          <div className="flex items-start gap-2">
            {title ? <AlertTitle className="mb-0 flex-1 min-w-0">{title}</AlertTitle> : <span className="flex-1" />}
            {timestamp ? (
              <span className="shrink-0 text-xs leading-5 opacity-60" data-slot="notification-timestamp">
                {timestamp}
              </span>
            ) : null}
          </div>
        )}
        {description ? (
          <AlertDescription className={cn('opacity-72', title && 'mt-1')} data-slot="notification-description">
            {description}
          </AlertDescription>
        ) : null}
        {actions ? (
          <div
            className={cn('flex flex-wrap items-center gap-2', (title || description) && 'mt-2.5')}
            data-slot="notification-actions"
          >
            {actions}
          </div>
        ) : null}
      </Alert>
    )
  },
)
Notification.displayName = 'Notification'
