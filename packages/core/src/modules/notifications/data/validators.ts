import { z } from 'zod'
import { isSafeNotificationHref } from '../lib/safeHref'

export const notificationStatusSchema = z.enum(['unread', 'read', 'actioned', 'dismissed'])
export const notificationSeveritySchema = z.enum(['info', 'warning', 'success', 'error'])

export const safeRelativeHrefSchema = z.string().min(1).refine(
  (href) => isSafeNotificationHref(href),
  { message: 'Href must be a same-origin relative path starting with /' }
)

export const notificationActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  labelKey: z.string().optional(),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline', 'ghost']).optional(),
  icon: z.string().optional(),
  commandId: z.string().optional(),
  href: safeRelativeHrefSchema.optional(),
  confirmRequired: z.boolean().optional(),
  confirmMessage: z.string().optional(),
})

/**
 * Flat per-provider push customization. Known keys are mapped onto each provider's native message
 * by the push adapters; unknown keys are accepted (passthrough) for providers that understand them.
 * See `communication_channels/lib/push-envelope.ts` (`PushOptions`).
 */
export const pushOptionsSchema = z
  .object({
    sound: z.string().optional(),
    badge: z.number().int().nonnegative().optional(),
    image: z.string().optional(),
    priority: z.enum(['high', 'normal']).optional(),
    channelId: z.string().optional(),
    body: z.string().optional(),
  })
  .catchall(z.unknown())

const baseNotificationFieldsSchema = z.object({
  type: z.string().min(1).max(100),
  titleKey: z.string().min(1).max(200).optional(),
  bodyKey: z.string().min(1).max(200).optional(),
  titleVariables: z.record(z.string(), z.string()).optional(),
  bodyVariables: z.record(z.string(), z.string()).optional(),
  title: z.string().min(1).max(500).optional(),
  body: z.string().max(2000).optional(),
  icon: z.string().max(100).optional(),
  severity: notificationSeveritySchema.optional().default('info'),
  actions: z.array(notificationActionSchema).optional(),
  primaryActionId: z.string().optional(),
  sourceModule: z.string().optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  linkHref: safeRelativeHrefSchema.optional(),
  groupKey: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  // Arbitrary app-readable key/values delivered with the push (and visible to in-app clients).
  data: z.record(z.string(), z.string()).optional(),
  // Per-provider push customization (sound, badge, image, priority, channelId, body override).
  pushOptions: pushOptionsSchema.optional(),
  // Explicit per-send channel target. When present, delivery is restricted to these channels
  // (intersected with the type's eligibility, the registered strategies, and the recipient's
  // preferences). Absent → all registered channels (pre-Phase-7 behavior). Must be non-empty when
  // provided: an empty array would resolve to zero deliverable channels and silently black-hole the
  // notification (invisible + undelivered) — omit the field instead to target every channel.
  channels: z.array(z.string().min(1).max(32)).min(1).optional(),
})

const titleRequiredRefinement = {
  refine: (data: { titleKey?: string; title?: string }) => data.titleKey || data.title,
  message: 'Either titleKey or title must be provided',
} as const

export const createNotificationSchema = baseNotificationFieldsSchema
  .extend({ recipientUserId: z.string().uuid() })
  .refine(titleRequiredRefinement.refine, { message: titleRequiredRefinement.message })

export const createBatchNotificationSchema = baseNotificationFieldsSchema
  .extend({ recipientUserIds: z.array(z.string().uuid()).min(1).max(1000) })
  .refine(titleRequiredRefinement.refine, { message: titleRequiredRefinement.message })

export const createRoleNotificationSchema = baseNotificationFieldsSchema
  .extend({ roleId: z.string().uuid() })
  .refine(titleRequiredRefinement.refine, { message: titleRequiredRefinement.message })

export const createFeatureNotificationSchema = baseNotificationFieldsSchema
  .extend({ requiredFeature: z.string().min(1).max(100) })
  .refine(titleRequiredRefinement.refine, { message: titleRequiredRefinement.message })

export const listNotificationsSchema = z.object({
  status: z.union([notificationStatusSchema, z.array(notificationStatusSchema)]).optional(),
  type: z.string().optional(),
  severity: notificationSeveritySchema.optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  since: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export const executeActionSchema = z.object({
  actionId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export const restoreNotificationSchema = z.object({
  status: z.enum(['read', 'unread']).optional(),
})

const notificationDeliveryStrategySchema = z.object({
  enabled: z.boolean().optional(),
})

const notificationDeliveryEmailSchema = notificationDeliveryStrategySchema.extend({
  from: z.string().trim().min(1).optional(),
  replyTo: z.string().trim().min(1).optional(),
  subjectPrefix: z.string().trim().min(1).optional(),
})

const notificationDeliveryCustomSchema = notificationDeliveryStrategySchema.extend({
  config: z.unknown().optional(),
})

export const notificationDeliveryConfigSchema = z.object({
  appUrl: z.string().url().optional(),
  panelPath: safeRelativeHrefSchema.optional(),
  strategies: z.object({
    database: notificationDeliveryStrategySchema.optional(),
    email: notificationDeliveryEmailSchema.optional(),
    custom: z.record(z.string(), notificationDeliveryCustomSchema).optional(),
  }).optional(),
})

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>
export type CreateBatchNotificationInput = z.infer<typeof createBatchNotificationSchema>
export type CreateRoleNotificationInput = z.infer<typeof createRoleNotificationSchema>
export type CreateFeatureNotificationInput = z.infer<typeof createFeatureNotificationSchema>
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>
export type ExecuteActionInput = z.infer<typeof executeActionSchema>
export type NotificationDeliveryConfigInput = z.infer<typeof notificationDeliveryConfigSchema>

// Notification type catalogue (DB-mirrored read model)
export const notificationTypeItemSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  descriptionKey: z.string().nullable().optional(),
  // Free-form grouping label so a client can list/group types under a heading. Defaults to
  // the prefix before the first dot in the type id (`sales.order.created` → `sales`), so in
  // practice it is always populated; kept nullable to avoid narrowing the response contract.
  // This is the STABLE grouping key — clients group on it and display `categoryLabel`.
  category: z.string().nullable().optional(),
  // Localized heading for `category`, resolved server-side from
  // `notifications.categories.<key>` with a humanized fallback. Display-only: grouping on it
  // re-partitions the list whenever the locale changes.
  categoryLabel: z.string().nullable(),
  // Server-resolved display strings so clients without the app dictionary (the mobile app)
  // need no i18n bundle. `null` iff the corresponding `*Key` is null.
  label: z.string().nullable(),
  description: z.string().nullable(),
  // When true the type is delivered as a silent / content-available push.
  silent: z.boolean(),
  // Effective "cannot be opted out of" flag (operator override ?? code-declared); a preferences
  // UI should lock the type on when true.
  nonOptOut: z.boolean(),
  // Effective channel eligibility for the caller's tenant (stored override ?? code-declared
  // `type.channels`). `null` = no restriction (every registered channel). A channel outside
  // the set never delivers for this type in the tenant and users cannot opt into it —
  // preference UIs lock the cell off.
  channels: z.array(z.string()).nullable(),
  // The raw tenant-stored override (`notification_type_overrides.channels`; `null` = inherit
  // code). Admin editors base PATCH payloads on the EFFECTIVE set, but this shows whether an
  // override exists at all.
  storedChannels: z.array(z.string()).nullable(),
  // The raw tenant-stored `nonOptOut` override (`null` = inherit the code-declared flag).
  storedNonOptOut: z.boolean().nullable(),
  // Optimistic-lock version of the tenant's override row (ISO timestamp; `null` when the
  // tenant stores no override yet). PATCH callers echo it back via the standard
  // `x-om-ext-optimistic-lock-expected-updated-at` header.
  updatedAt: z.string().nullable(),
})

// PATCH /api/notifications/types — operator override of a type's channel eligibility and/or
// nonOptOut governance. Omitted fields stay untouched; `null` clears the stored override so
// the code declaration applies again.
export const updateNotificationTypeSchema = z
  .object({
    id: z.string().min(1),
    channels: z.array(z.string().min(1)).nullable().optional(),
    nonOptOut: z.boolean().nullable().optional(),
  })
  .refine((value) => value.channels !== undefined || value.nonOptOut !== undefined, {
    message: 'At least one of channels or nonOptOut must be provided',
  })

// Per-user channel preferences
export const notificationPreferenceItemSchema = z.object({
  notificationTypeId: z.string(),
  channel: z.string(),
  enabled: z.boolean(),
})

export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        notificationTypeId: z.string().trim().min(1).max(128),
        channel: z.string().trim().min(1).max(32),
        enabled: z.boolean(),
      }),
    )
    .max(500),
})

// Admin-on-behalf preference management (target a specific user)
export const adminPreferencesQuerySchema = z.object({
  userId: z.string().uuid(),
})

export const adminUpdatePreferencesSchema = updatePreferencesSchema.extend({
  userId: z.string().uuid(),
})

export type NotificationTypeItem = z.infer<typeof notificationTypeItemSchema>
export type UpdateNotificationTypeInput = z.infer<typeof updateNotificationTypeSchema>
export type NotificationPreferenceItem = z.infer<typeof notificationPreferenceItemSchema>
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>
export type AdminUpdatePreferencesInput = z.infer<typeof adminUpdatePreferencesSchema>
