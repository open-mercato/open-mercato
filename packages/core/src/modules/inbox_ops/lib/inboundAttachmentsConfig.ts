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
  /**
   * The test-only Resend stub is on: `OM_ENABLE_RESEND_STUB` is true and `RESEND_API_KEY` is a stub
   * key (`re_stub_…`), the same condition the stub routes in the `example` module require.
   */
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

const INBOUND_ATTACHMENTS_ENV_NAMES = [
  'INBOX_OPS_ATTACHMENTS_ENABLED',
  'INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS',
  'OM_ENABLE_RESEND_STUB',
  'INBOX_OPS_MAX_ATTACHMENTS',
  'INBOX_OPS_MAX_ATTACHMENTS_TOTAL_BYTES',
  'INBOX_OPS_INLINE_IMAGE_MIN_BYTES',
  'INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS',
  'INBOX_OPS_ATTACHMENT_LEASE_MS',
  'INBOX_OPS_ATTACHMENT_RETRY_DELAY_MS',
  'INBOX_OPS_ATTACHMENT_MAX_PART_ATTEMPTS',
  'INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS',
  'INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS_PER_FILE',
] as const

type InboundAttachmentsEnvName = (typeof INBOUND_ATTACHMENTS_ENV_NAMES)[number]

function readEnvInput(env: InboundAttachmentsEnv): Record<InboundAttachmentsEnvName, string | undefined> {
  const input = {} as Record<InboundAttachmentsEnvName, string | undefined>
  for (const name of INBOUND_ATTACHMENTS_ENV_NAMES) input[name] = env[name]
  return input
}

/** Prefix of the Resend stub's API keys; mirrors `RESEND_STUB_API_KEY_PREFIX` of the example module's stub. */
export const RESEND_STUB_API_KEY_PREFIX = 're_stub_'

function isResendStubApiKey(value: string | undefined): boolean {
  const key = value?.trim() ?? ''
  return key.startsWith(RESEND_STUB_API_KEY_PREFIX) && key.length > RESEND_STUB_API_KEY_PREFIX.length
}

function toConfig(values: z.infer<typeof inboundAttachmentsEnvSchema>, env: InboundAttachmentsEnv): InboundAttachmentsConfig {
  return {
    enabled: values.INBOX_OPS_ATTACHMENTS_ENABLED,
    allowUnguardedReaders: values.INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS,
    resendStubEnabled: values.OM_ENABLE_RESEND_STUB && isResendStubApiKey(env.RESEND_API_KEY),
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

function toConfigError(error: z.ZodError): InboundAttachmentsConfigError {
  return new InboundAttachmentsConfigError(
    error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`),
  )
}

/**
 * Reads and validates the inbound-attachment settings. Unset or blank variables take their
 * defaults; a malformed value or a lease outside `(4 x fetch timeout, lockDuration]` throws
 * `InboundAttachmentsConfigError`. Runtime paths use {@link resolveInboundAttachmentsConfig}.
 */
export function readInboundAttachmentsConfig(env: InboundAttachmentsEnv = process.env): InboundAttachmentsConfig {
  const parsed = inboundAttachmentsEnvSchema.safeParse(readEnvInput(env))
  if (!parsed.success) throw toConfigError(parsed.error)
  return toConfig(parsed.data, env)
}

export type ResolvedInboundAttachmentsConfig = {
  config: InboundAttachmentsConfig
  /** The validation error the fallback replaced, or `null` for a valid environment. */
  error: InboundAttachmentsConfigError | null
}

/**
 * Like {@link readInboundAttachmentsConfig}, but never throws: each malformed variable falls back
 * to its default, so a typo in one setting cannot fail every webhook or stop the sweep. Two
 * fallbacks are chosen for safety rather than taken from the defaults: a malformed kill switch
 * (`INBOX_OPS_ATTACHMENTS_ENABLED`) turns ingestion off, and a lease outside
 * `(4 x fetch timeout, lockDuration]` resets both the lease and the fetch timeout to their
 * defaults, a pair known to satisfy the bound. The caller reports `error`.
 */
export function resolveInboundAttachmentsConfig(env: InboundAttachmentsEnv = process.env): ResolvedInboundAttachmentsConfig {
  const input = readEnvInput(env)
  const parsed = inboundAttachmentsEnvSchema.safeParse(input)
  if (parsed.success) return { config: toConfig(parsed.data, env), error: null }
  const error = toConfigError(parsed.error)
  const repaired: Record<string, string | undefined> = { ...input }
  for (const issue of parsed.error.issues) {
    const name = issue.path[0]
    if (name === 'INBOX_OPS_ATTACHMENTS_ENABLED') {
      repaired[name] = 'false'
    } else if (name === 'INBOX_OPS_ATTACHMENT_LEASE_MS' || name === 'INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS') {
      repaired.INBOX_OPS_ATTACHMENT_LEASE_MS = undefined
      repaired.INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS = undefined
    } else if (typeof name === 'string') {
      repaired[name] = undefined
    }
  }
  const retried = inboundAttachmentsEnvSchema.safeParse(repaired)
  if (retried.success) return { config: toConfig(retried.data, env), error }
  // Unreachable with valid defaults; still fail closed rather than throw.
  return {
    config: {
      ...INBOUND_ATTACHMENTS_CONFIG_DEFAULTS,
      enabled: false,
      maxFileBytes: resolveAttachmentMaxBytes(null),
    },
    error,
  }
}
