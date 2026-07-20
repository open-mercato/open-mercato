import type { ComponentType } from 'react'

export type NotificationStatus = 'unread' | 'read' | 'actioned' | 'dismissed'
export type NotificationSeverity = 'info' | 'warning' | 'success' | 'error'

export type NotificationAction = {
  id: string
  label: string
  labelKey?: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  icon?: string
  commandId?: string
  href?: string
  confirmRequired?: boolean
  confirmMessage?: string
}

export type NotificationActionData = {
  actions: NotificationAction[]
  primaryActionId?: string
}

export type NotificationTypeAction = {
  id: string
  labelKey: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  icon?: string
  commandId?: string
  href?: string
  confirmRequired?: boolean
  confirmMessageKey?: string
}

export type NotificationRendererProps = {
  notification: {
    id: string
    type: string
    title: string
    body?: string | null
    titleKey?: string | null
    bodyKey?: string | null
    titleVariables?: Record<string, string> | null
    bodyVariables?: Record<string, string> | null
    icon?: string | null
    severity: string
    status: string
    sourceModule?: string | null
    sourceEntityType?: string | null
    sourceEntityId?: string | null
    linkHref?: string | null
    createdAt: string
  }
  onAction: (actionId: string) => Promise<void>
  onDismiss: () => Promise<void>
  actions: NotificationTypeAction[]
}

export type NotificationTypeDefinition = {
  type: string
  module: string
  titleKey: string
  bodyKey?: string
  icon: string
  severity: NotificationSeverity
  actions: NotificationTypeAction[]
  primaryActionId?: string
  linkHref?: string
  Renderer?: ComponentType<NotificationRendererProps>
  expiresAfterHours?: number
  /**
   * Optional i18n key for the short type name shown in a per-channel
   * preferences UI (e.g. "Order created"). Distinct from `titleKey`, which is
   * the per-instance message title. Falls back to `titleKey` when omitted.
   */
  labelKey?: string
  /** Optional i18n key for helper text shown beside the type in a preferences UI. */
  descriptionKey?: string
  /**
   * Optional free-form grouping label (e.g. `security`, `orders`, `marketing`) so a
   * client — typically a mobile app — can list/group notification types under a heading.
   * Plain string, not an enum; mirrored to the `notification_types` table and returned by
   * `GET /api/notifications/types`.
   */
  category?: string
  /**
   * When `true`, this type's push is delivered as a silent / content-available (data-only)
   * wake-up instead of a visible alert. `silent` selects the delivery STYLE only — the
   * notification still flows through the normal `notificationService.create()` path (in-app
   * row created, per-channel preferences respected unless the type is `nonOptOut`).
   */
  silent?: boolean
  /**
   * When `true`, the recipient cannot opt out of this type: delivery ignores any
   * stored per-channel preference (security/account alerts that must always be
   * delivered). A preferences UI should render it as locked/forced-on, and
   * `setPreferences` refuses to store an opt-out row for it.
   */
  nonOptOut?: boolean
  /**
   * When `true`, this type is hidden from the client-facing catalogue: it is NOT mirrored to the
   * `notification_types` table and therefore not returned by `GET /api/notifications/types`, so a
   * mobile app's preferences screen never lists it. Used for internal/admin-only types (e.g. one-off
   * admin custom pushes) that are dispatched by the server, not toggled by users. The type still
   * lives in the in-memory registry for delivery logic (`getNotificationType`).
   */
  hiddenFromSettings?: boolean
  /**
   * Optional per-type channel eligibility: the delivery channels this type may EVER use
   * (e.g. a marketing type restricted to `['push']` so it never lands in the in-app bell).
   * The dispatcher intersects it with the per-send target, the registered strategies, and the
   * recipient's preferences via `shouldDeliver`. Omit to make the type eligible for every
   * registered channel (pre-Phase-7 behavior).
   *
   * Operators can override this set per tenant via the `notification_type_overrides` table
   * (`PATCH /api/notifications/types` / the Notification Delivery settings page): a stored
   * array replaces the code-declared one, an absent row (or `NULL`) inherits it. A channel
   * outside the effective set never delivers for the type in that tenant — the check runs
   * before both the `nonOptOut` bypass and user preferences, and the preference UIs render
   * that cell locked off.
   */
  channels?: string[]
}

/**
 * A delivery channel in the module-registered channel catalogue. Any module can contribute channels
 * by exporting `notificationChannels: NotificationChannelDefinition[]` from a `notification-channels.ts`
 * file (generator-discovered), so a preferences UI and the `/api/notifications/channels` endpoint stay
 * in sync with the actual delivery paths without a hardcoded list. `id` matches the delivery-strategy id
 * (`in_app`, `email`, `push`, …) — treat it as a FROZEN contract once shipped.
 */
export type NotificationChannelDefinition = {
  id: string
  /** i18n key for the channel's display name in a preferences UI. */
  labelKey: string
  /** Optional i18n key for helper text shown beside the channel. */
  descriptionKey?: string
  /** Ascending display order; entries without an order sort after ordered ones, then by id. */
  order?: number
}

export type NotificationDto = {
  id: string
  type: string
  title: string
  body?: string | null
  titleKey?: string | null
  bodyKey?: string | null
  titleVariables?: Record<string, string> | null
  bodyVariables?: Record<string, string> | null
  icon?: string | null
  severity: string
  status: string
  actions: Array<{
    id: string
    label: string
    labelKey?: string
    variant?: string
    icon?: string
  }>
  primaryActionId?: string
  sourceModule?: string | null
  sourceEntityType?: string | null
  sourceEntityId?: string | null
  linkHref?: string | null
  /** Arbitrary app-readable key/values attached at create time (also delivered with the push). */
  data?: Record<string, string> | null
  /** Resolved delivery channels for this notification. `null` = all channels (legacy/untargeted). */
  channels?: string[] | null
  createdAt: string
  readAt?: string | null
  actionTaken?: string | null
}

export type NotificationPollData = {
  unreadCount: number
  recent: NotificationDto[]
  hasNew: boolean
  lastId?: string
}
