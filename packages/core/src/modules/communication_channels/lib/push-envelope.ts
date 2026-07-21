import type { MessageContent } from './adapter'

/**
 * Flat, provider-agnostic push customization a caller can attach to a
 * notification (via `Notification.pushOptions`) or a silent push. Each push
 * adapter maps the recognized keys onto its own provider message shape (see
 * {@link readPushOptions}); unknown keys are ignored by the adapters but kept on
 * the envelope so a provider that understands them can still read them.
 */
export interface PushOptions {
  /** Notification sound (provider default when omitted). */
  sound?: string
  /** App icon badge count (iOS / supported Android launchers). */
  badge?: number
  /** Rich image URL shown in the expanded notification. */
  image?: string
  /** Delivery priority. Maps to FCM `android.priority` / `apns-priority` / Expo `priority`. */
  priority?: 'high' | 'normal'
  /** Android notification channel id (FCM `android.notification.channel_id` / Expo `channelId`). */
  channelId?: string
  /** Overrides the push body text without changing the in-app notification body. */
  body?: string
  [key: string]: unknown
}

/**
 * The push payload the `push_notifications` worker packs into
 * `SendMessageInput.content.raw` before calling a push adapter's `sendMessage`
 * (see `push_notifications/lib/push-delivery.ts`). Each provider adapter
 * (fcm/apns/expo) reads it the same way via {@link readPushEnvelope} so the
 * title/body/data contract stays uniform.
 */
export interface PushEnvelope {
  title: string
  body: string
  data: Record<string, string>
  /** Flat per-provider customization; see {@link PushOptions}. */
  options: PushOptions
  /**
   * When `true`, deliver as a silent / content-available wake-up: no visible
   * alert (title/body omitted), data-only payload. Adapters branch on this.
   */
  silent: boolean
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null) continue
    out[key] = typeof raw === 'string' ? raw : String(raw)
  }
  return out
}

function toPushOptions(value: unknown): PushOptions {
  if (!value || typeof value !== 'object') return {}
  return { ...(value as PushOptions) }
}

/** Read the normalized push envelope from a hub `MessageContent`. Defensive against missing fields. */
export function readPushEnvelope(content: MessageContent | undefined): PushEnvelope {
  const raw = (content?.raw ?? {}) as {
    title?: unknown
    body?: unknown
    data?: unknown
    options?: unknown
    silent?: unknown
  }
  const title = typeof raw.title === 'string' ? raw.title : ''
  const body = typeof raw.body === 'string' ? raw.body : content?.text ?? ''
  return {
    title,
    body,
    data: toStringRecord(raw.data),
    options: toPushOptions(raw.options),
    silent: raw.silent === true,
  }
}

/** The push body text after applying a non-empty `pushOptions.body` override, if present. */
export function resolvePushBody(envelope: PushEnvelope): string {
  const override = envelope.options.body
  return typeof override === 'string' && override.length > 0 ? override : envelope.body
}
