import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type PushDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'expired'

/**
 * Append-only delivery log for a single push notification attempt against one device.
 *
 * One row per (notification, device). The strategy inserts rows `pending`; the `send-push` worker
 * atomically claims a row (`pending` → `sending`, so a redelivered job is processed once) and then
 * transitions it to `sent`/`failed`/`skipped`, or `expired` once retries are exhausted. This is a
 * background-job/log row, so it is intentionally EXEMPT from optimistic locking
 * (status transitions are server-driven, never concurrently user-edited) and is
 * NOT added to the curated `optimistic-lock-editable-entities` list.
 *
 * `push_token` is a secret: the full token is never persisted here — only
 * `token_snapshot` (last 8 chars, for debugging across token rotation) plus the
 * `provider` snapshot so the audit trail survives token rotation and device deletion.
 */
@Entity({ tableName: 'push_notification_deliveries' })
@Index({ name: 'push_notification_deliveries_tenant_status_idx', properties: ['tenantId', 'status', 'createdAt'] })
@Index({ name: 'push_notification_deliveries_notification_idx', properties: ['notificationId'] })
// Idempotency guard for the fan-out: the `push` strategy runs inside the at-least-once persistent
// `notifications:deliver` subscriber, so a redelivered event would otherwise insert a second set of
// rows for the same (notification, device) → a duplicate push. A partial unique index (only where
// notification_id is set — direct/silent pushes without a notification are out of scope) lets the
// strategy insert-on-conflict-do-nothing, making a re-run a no-op.
@Index({
  name: 'push_notification_deliveries_notif_device_unique',
  expression:
    'create unique index "push_notification_deliveries_notif_device_unique" on "push_notification_deliveries" ("notification_id", "user_device_id") where "notification_id" is not null',
})
export class PushNotificationDelivery {
  [OptionalProps]?:
    | 'organizationId'
    | 'notificationId'
    | 'status'
    | 'attempts'
    | 'lastError'
    | 'providerResponse'
    | 'silent'
    | 'createdAt'
    | 'sentAt'
    | 'nextRetryAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  // Soft FK -> notifications.notifications (nullable: a push can be dispatched without an in-app row).
  @Property({ name: 'notification_id', type: 'uuid', nullable: true })
  notificationId?: string | null

  @Property({ name: 'notification_type_id', type: 'text' })
  notificationTypeId!: string

  // Soft FK -> devices.user_devices (link declared in data/extensions.ts).
  @Property({ name: 'user_device_id', type: 'uuid' })
  userDeviceId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  // Snapshot of the push CommunicationChannel providerKey used at send time.
  @Property({ name: 'provider', type: 'text' })
  provider!: string

  // Last 8 chars of the device push token only — never the full secret.
  @Property({ name: 'token_snapshot', type: 'text' })
  tokenSnapshot!: string

  // Snapshot of whether this was a silent / content-available wake-up (derived from the
  // notification type's `silent` flag at fan-out time) so the log distinguishes silent deliveries.
  @Property({ name: 'silent', type: 'boolean', default: false })
  silent: boolean = false

  @Property({ name: 'status', type: 'text', default: 'pending' })
  status: PushDeliveryStatus = 'pending'

  @Property({ name: 'attempts', type: 'int', default: 0 })
  attempts: number = 0

  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  @Property({ name: 'payload', type: 'json' })
  payload!: Record<string, unknown>

  @Property({ name: 'provider_response', type: 'json', nullable: true })
  providerResponse?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'sent_at', type: Date, nullable: true })
  sentAt?: Date | null

  // Set when a retryable failure re-enqueues the job (observability for the admin delivery log);
  // cleared once the delivery reaches a terminal state.
  @Property({ name: 'next_retry_at', type: Date, nullable: true })
  nextRetryAt?: Date | null

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
