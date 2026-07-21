import { z } from 'zod'
import { pushOptionsSchema } from '@open-mercato/core/modules/notifications/data/validators'

export const PUSH_DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped', 'expired'] as const

// A `created_at` range bound: an ISO-8601 date (`2026-07-01`) or datetime (`2026-07-01T00:00:00Z`).
// Validated here so a malformed value fails with a 400 instead of reaching the query engine / Postgres.
const rangeDateFilter = z.union([z.string().datetime({ offset: true }), z.string().date()])

// POST /api/push_notifications/custom-send — admin composes a one-off visible push to a single user.
// title/body are literal free text (not i18n keys). data/pushOptions reuse the notifications contract.
export const customSendSchema = z
  .object({
    recipientUserId: z.string().uuid(),
    // Optional: target one of the recipient's devices; omit to send to all their devices.
    deviceId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(500),
    body: z.string().trim().max(2000).nullish(),
    data: z.record(z.string(), z.string()).optional(),
    pushOptions: pushOptionsSchema.optional(),
    // When true, deliver a silent data-only wake-up instead of a visible banner.
    silent: z.boolean().optional(),
  })
  .strict()
export type CustomSendInput = z.infer<typeof customSendSchema>

// Machine-readable warning surfaced when a well-formed send resolved no deliverable device in scope
// (no push channel configured, no in-scope devices, or none whose provider matches an active channel).
// The caller gets `enqueued: 0` plus this code + a human `message` instead of a misleading silent success.
export const CUSTOM_SEND_NO_DEVICES_WARNING = 'no_matching_devices_in_scope'

export const customSendResponseSchema = z.object({
  enqueued: z.number(),
  warning: z.literal(CUSTOM_SEND_NO_DEVICES_WARNING).optional(),
  message: z.string().optional(),
})

// Read-only delivery-log list contract (admin observability). No full push token is ever exposed —
// only `token_snapshot` (last 8 chars) and the `provider` snapshot.
export const deliveryListSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    status: z.enum(PUSH_DELIVERY_STATUSES).optional(),
    userId: z.string().uuid().optional(),
    from: rangeDateFilter.optional(),
    to: rangeDateFilter.optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export const deliveryListFields: string[] = [
  'id',
  'tenant_id',
  'organization_id',
  'notification_id',
  'notification_type_id',
  'user_device_id',
  'user_id',
  'provider',
  'token_snapshot',
  'status',
  'attempts',
  'last_error',
  'created_at',
  'sent_at',
  'next_retry_at',
  'updated_at',
]

export const deliveryListSortFieldMap: Record<string, string> = {
  createdAt: 'created_at',
  sentAt: 'sent_at',
  updatedAt: 'updated_at',
  status: 'status',
}

export const deliveryListItemSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organization_id: z.string().uuid().nullable().optional(),
  notification_id: z.string().uuid().nullable().optional(),
  notification_type_id: z.string(),
  user_device_id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider: z.string(),
  token_snapshot: z.string(),
  status: z.enum(PUSH_DELIVERY_STATUSES),
  attempts: z.number(),
  last_error: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  next_retry_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

// Detail adds the JSON payload + provider response (still no full token).
export const deliveryDetailItemSchema = deliveryListItemSchema.extend({
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  provider_response: z.record(z.string(), z.unknown()).nullable().optional(),
})
