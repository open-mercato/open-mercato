import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveAttachmentMaxBytes } from '@open-mercato/core/modules/attachments/lib/upload-limits'

/**
 * `lockDuration` of the ingest worker. `WorkerMeta.lockDuration` must repeat this value as a
 * literal (the generator copies it at `yarn generate` time); the lease may not exceed it.
 */
export const INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS = 1_800_000

/** Bounded provider calls one part may need: list, get, download, and a refreshed get after an expired URL. */
export const INBOX_OPS_ATTACHMENT_FETCH_CALLS_PER_PART = 4

const KIB = 1024
const MIB = 1024 * KIB

export const INBOUND_ATTACHMENTS_CONFIG_DEFAULTS = {
  enabled: true,
  allowUnguardedReaders: false,
  resendStubEnabled: false,
  maxAttachments: 20,
  maxTotalBytes: 25 * MIB,
  inlineImageMinBytes: 16 * KIB,
  fetchTimeoutMs: 30_000,
  leaseMs: INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS,
  retryDelayMs: 900_000,
  maxPartAttempts: 3,
  maxTextChars: 60_000,
  maxTextCharsPerFile: 20_000,
} as const

function blankToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return value.trim() === '' ? undefined : value.trim()
}

function envBoolean(fallback: boolean) {
  return z.preprocess(
    blankToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return fallback
        const parsed = parseBooleanToken(value)
        if (parsed === null) {
          ctx.addIssue({ code: 'custom', message: 'expected a boolean (true/false)' })
          return z.NEVER
        }
        return parsed
      }),
  )
}

function envInteger(fallback: number, min: number) {
  return z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(min).max(Number.MAX_SAFE_INTEGER).default(fallback),
  )
}

const defaults = INBOUND_ATTACHMENTS_CONFIG_DEFAULTS

const inboundAttachmentsEnvSchema = z
  .object({
    INBOX_OPS_ATTACHMENTS_ENABLED: envBoolean(defaults.enabled),
    INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS: envBoolean(defaults.allowUnguardedReaders),
    OM_ENABLE_RESEND_STUB: envBoolean(defaults.resendStubEnabled),
    INBOX_OPS_MAX_ATTACHMENTS: envInteger(defaults.maxAttachments, 1),
    INBOX_OPS_MAX_ATTACHMENTS_TOTAL_BYTES: envInteger(defaults.maxTotalBytes, 1),
    INBOX_OPS_INLINE_IMAGE_MIN_BYTES: envInteger(defaults.inlineImageMinBytes, 0),
    INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS: envInteger(defaults.fetchTimeoutMs, 1),
    INBOX_OPS_ATTACHMENT_LEASE_MS: envInteger(defaults.leaseMs, 1),
    INBOX_OPS_ATTACHMENT_RETRY_DELAY_MS: envInteger(defaults.retryDelayMs, 1),
    INBOX_OPS_ATTACHMENT_MAX_PART_ATTEMPTS: envInteger(defaults.maxPartAttempts, 1),
    INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS: envInteger(defaults.maxTextChars, 1),
    INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS_PER_FILE: envInteger(defaults.maxTextCharsPerFile, 1),
  })
  .superRefine((env, ctx) => {
    const leaseMs = env.INBOX_OPS_ATTACHMENT_LEASE_MS
    const minimumLeaseMs = INBOX_OPS_ATTACHMENT_FETCH_CALLS_PER_PART * env.INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS
    if (leaseMs <= minimumLeaseMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['INBOX_OPS_ATTACHMENT_LEASE_MS'],
        message: `must exceed ${INBOX_OPS_ATTACHMENT_FETCH_CALLS_PER_PART} x INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS (${minimumLeaseMs})`,
      })
    }
    if (leaseMs > INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['INBOX_OPS_ATTACHMENT_LEASE_MS'],
        message: `must not exceed the ingest worker lockDuration (${INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS})`,
      })
    }
  })

export type InboundAttachmentsConfig = {
  /** `INBOX_OPS_ATTACHMENTS_ENABLED`: the kill switch for new mail. */
  enabled: boolean
  /** Raw D19 test opt-out; honored only together with `resendStubEnabled` (the gate decides). */
  allowUnguardedReaders: boolean
  resendStubEnabled: boolean
  maxAttachments: number
  maxTotalBytes: number
  /** The attachments module's per-file upload maximum (`OM_ATTACHMENT_MAX_UPLOAD_MB`, 25 MiB). */
  maxFileBytes: number
  inlineImageMinBytes: number
  fetchTimeoutMs: number
  leaseMs: number
  retryDelayMs: number
  maxPartAttempts: number
  maxTextChars: number
  maxTextCharsPerFile: number
}

export class InboundAttachmentsConfigError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`[internal] Invalid inbox_ops attachment configuration: ${issues.join('; ')}`)
    this.name = 'InboundAttachmentsConfigError'
    this.issues = issues
  }
}

export type InboundAttachmentsEnv = Readonly<Record<string, string | undefined>>

/**
 * Reads and validates the inbound-attachment settings. Unset or blank variables take their
 * defaults; a malformed value or a lease outside `(4 x fetch timeout, lockDuration]` throws
 * `InboundAttachmentsConfigError`.
 */
export function readInboundAttachmentsConfig(env: InboundAttachmentsEnv = process.env): InboundAttachmentsConfig {
  const parsed = inboundAttachmentsEnvSchema.safeParse({
    INBOX_OPS_ATTACHMENTS_ENABLED: env.INBOX_OPS_ATTACHMENTS_ENABLED,
    INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS: env.INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS,
    OM_ENABLE_RESEND_STUB: env.OM_ENABLE_RESEND_STUB,
    INBOX_OPS_MAX_ATTACHMENTS: env.INBOX_OPS_MAX_ATTACHMENTS,
    INBOX_OPS_MAX_ATTACHMENTS_TOTAL_BYTES: env.INBOX_OPS_MAX_ATTACHMENTS_TOTAL_BYTES,
    INBOX_OPS_INLINE_IMAGE_MIN_BYTES: env.INBOX_OPS_INLINE_IMAGE_MIN_BYTES,
    INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS: env.INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS,
    INBOX_OPS_ATTACHMENT_LEASE_MS: env.INBOX_OPS_ATTACHMENT_LEASE_MS,
    INBOX_OPS_ATTACHMENT_RETRY_DELAY_MS: env.INBOX_OPS_ATTACHMENT_RETRY_DELAY_MS,
    INBOX_OPS_ATTACHMENT_MAX_PART_ATTEMPTS: env.INBOX_OPS_ATTACHMENT_MAX_PART_ATTEMPTS,
    INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS: env.INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS,
    INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS_PER_FILE: env.INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS_PER_FILE,
  })
  if (!parsed.success) {
    throw new InboundAttachmentsConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`),
    )
  }
  const values = parsed.data
  return {
    enabled: values.INBOX_OPS_ATTACHMENTS_ENABLED,
    allowUnguardedReaders: values.INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS,
    resendStubEnabled: values.OM_ENABLE_RESEND_STUB,
    maxAttachments: values.INBOX_OPS_MAX_ATTACHMENTS,
    maxTotalBytes: values.INBOX_OPS_MAX_ATTACHMENTS_TOTAL_BYTES,
    maxFileBytes: resolveAttachmentMaxBytes(null),
    inlineImageMinBytes: values.INBOX_OPS_INLINE_IMAGE_MIN_BYTES,
    fetchTimeoutMs: values.INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS,
    leaseMs: values.INBOX_OPS_ATTACHMENT_LEASE_MS,
    retryDelayMs: values.INBOX_OPS_ATTACHMENT_RETRY_DELAY_MS,
    maxPartAttempts: values.INBOX_OPS_ATTACHMENT_MAX_PART_ATTEMPTS,
    maxTextChars: values.INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS,
    maxTextCharsPerFile: values.INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS_PER_FILE,
  }
}
