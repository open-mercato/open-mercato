import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  getAttachmentExtension,
  hasDangerousExecutableExtension,
  type AttachmentService,
} from '@open-mercato/core/modules/attachments'
import type { ChannelCapabilities, NormalizedAttachment } from './adapter'
import { EMAIL_MAX_ATTACHMENT_BYTES } from './email-capabilities'

const logger = createLogger('communication_channels').child({ component: 'outbound-attachments' })

/**
 * Outbound attachments for `send-as-user`.
 *
 * Only references travel with the message: `sendAsUser` validates them for the
 * actor and stores `{ attachmentId, owner, filename }` under a hub-owned
 * `channelMetadata` key; the delivery command reads the bytes through the
 * attachments service when it sends, so a retry re-reads instead of keeping
 * file bytes in the queue payload or the database.
 */

export const OUTBOUND_ATTACHMENTS_METADATA_KEY = 'outboundAttachments'
export const OUTBOUND_ATTACHMENTS_MAX_COUNT = 10
export const OUTBOUND_ATTACHMENTS_MAX_TOTAL_BYTES = EMAIL_MAX_ATTACHMENT_BYTES

// Control and bidirectional-override characters let a name display as
// something it is not (e.g. "Invoice\u202Efdp.vbs" renders as "Invoicesbv.pdf").
const UNSAFE_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

/**
 * The display name the recipient sees. It is held to the attachments module's
 * upload rules, so an override cannot turn a stored file into an executable or
 * a name that renders as a different one. The request schema bounds only its
 * length; `validateOutboundAttachments` applies these rules so a refusal
 * carries the `attachment_type_not_allowed` code.
 */
const attachmentFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !UNSAFE_FILENAME_CHARACTERS.test(value), { message: 'Filename contains control characters' })
  .refine((value) => !hasDangerousExecutableExtension(value), { message: 'Filename has a blocked extension' })

const attachmentOwnerSchema = z.object({
  entityId: z.string().min(1).max(200),
  recordId: z.string().min(1).max(200),
})

export const outboundAttachmentRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('attachment'),
    attachmentId: z.string().uuid(),
    owner: attachmentOwnerSchema,
    filename: z.string().max(255).optional(),
  }),
])

export const outboundAttachmentRefsSchema = z.array(outboundAttachmentRefSchema).max(OUTBOUND_ATTACHMENTS_MAX_COUNT)

export type OutboundAttachmentRef = z.infer<typeof outboundAttachmentRefSchema>

/**
 * Parse refs handed to the facade in-process, where the HTTP route's schema
 * did not run. The count is left to `validateOutboundAttachments`, which
 * reports it with its own code.
 */
export function parseOutboundAttachmentRefs(value: unknown): OutboundAttachmentRef[] | null {
  const parsed = z.array(outboundAttachmentRefSchema).safeParse(value)
  return parsed.success ? parsed.data : null
}

const storedOutboundAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
  owner: attachmentOwnerSchema,
  filename: attachmentFilenameSchema.optional(),
})

export type StoredOutboundAttachment = z.infer<typeof storedOutboundAttachmentSchema>

export type OutboundAttachmentErrorCode =
  | 'attachments_unsupported'
  | 'too_many_attachments'
  | 'duplicate_attachment'
  | 'attachment_not_found'
  | 'attachment_type_not_allowed'
  | 'attachments_too_large'

const ERROR_MESSAGES: Record<OutboundAttachmentErrorCode, { key: string; fallback: string }> = {
  attachments_unsupported: {
    key: 'communication_channels.errors.attachments.unsupported',
    fallback: 'This mailbox cannot send attachments.',
  },
  too_many_attachments: {
    key: 'communication_channels.errors.attachments.tooMany',
    fallback: 'A message can carry at most {max} attachments.',
  },
  duplicate_attachment: {
    key: 'communication_channels.errors.attachments.duplicate',
    fallback: 'The same file is attached more than once.',
  },
  attachment_not_found: {
    key: 'communication_channels.errors.attachments.notFound',
    fallback: 'One of the attached files is not available.',
  },
  attachment_type_not_allowed: {
    key: 'communication_channels.errors.attachments.typeNotAllowed',
    fallback: 'One of the attached files has a type this mailbox does not send.',
  },
  attachments_too_large: {
    key: 'communication_channels.errors.attachments.tooLarge',
    fallback: 'The attachments exceed the {limit} MB limit for this mailbox.',
  },
}

export type OutboundAttachmentScope = {
  userId: string
  tenantId: string
  organizationId: string | null
}

export type ValidateOutboundAttachmentsResult =
  | { ok: true; stored: StoredOutboundAttachment[] }
  | { ok: false; status: 422; code: OutboundAttachmentErrorCode; error: string }

/**
 * Error raised at delivery time when a stored reference can no longer be sent.
 * `transient: false` makes the delivery command fail the link permanently: a
 * message is never sent without the attachment its author picked.
 */
export class OutboundAttachmentDeliveryError extends Error {
  readonly transient = false
  constructor(readonly code: 'attachment_unavailable' | 'attachments_unsupported' | 'attachments_too_large') {
    super(`[internal] outbound attachment rejected at delivery: ${code}`)
    this.name = 'OutboundAttachmentDeliveryError'
  }
}

/**
 * Raised at delivery time when the attachment row is still readable but its
 * bytes are not: the attachments service reports a storage read failure as a
 * missing file, and a storage outage must not fail the message for good.
 * `transient: true` makes the worker retry the delivery.
 */
export class OutboundAttachmentStorageError extends Error {
  readonly transient = true
  readonly code = 'attachment_storage_unavailable'
  constructor() {
    super('[internal] outbound attachment bytes could not be read from storage (attachment_storage_unavailable)')
    this.name = 'OutboundAttachmentStorageError'
  }
}

/**
 * The attachments service answers 401/403/404 when the actor may not read the
 * file or it is gone; anything else (a database or configuration failure) is
 * not a verdict on the file and must reach the caller unchanged.
 */
function isAttachmentRefused(error: unknown): boolean {
  return isCrudHttpError(error) && (error.status === 401 || error.status === 403 || error.status === 404)
}

function buildActorAuth(scope: OutboundAttachmentScope): NonNullable<AuthContext> {
  return { sub: scope.userId, userId: scope.userId, tenantId: scope.tenantId, orgId: scope.organizationId }
}

function totalLimitBytes(capabilities: ChannelCapabilities): number {
  return capabilities.maxTotalBytes ?? OUTBOUND_ATTACHMENTS_MAX_TOTAL_BYTES
}

function isAllowedMimeType(capabilities: ChannelCapabilities, mimeType: string): boolean {
  const allowed = capabilities.supportedMimeTypes
  if (!allowed || allowed.length === 0) return true
  return allowed.includes(mimeType.split(';')[0].trim().toLowerCase())
}

async function fail(
  code: OutboundAttachmentErrorCode,
  limitBytes = 0,
): Promise<ValidateOutboundAttachmentsResult> {
  const { t } = await resolveTranslations()
  const message = ERROR_MESSAGES[code]
  const limit = Math.floor(limitBytes / 1_000_000)
  return {
    ok: false,
    status: 422,
    code,
    error: t(message.key, message.fallback, { max: OUTBOUND_ATTACHMENTS_MAX_COUNT, limit }),
  }
}

function isAttachmentServiceNotRegistered(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'AwilixResolutionError' &&
    error.message.startsWith("Could not resolve 'attachmentService'")
  )
}

function reportAttachmentServiceFailure(error: unknown): void {
  logger.warn('attachmentService could not be resolved, treating attachments as unavailable', { err: error })
  try {
    getTelemetryRuntime()?.reportError(error, {
      module: 'communication_channels',
      code: 'communication_channels.attachment_service_unavailable',
    })
  } catch (telemetryError) {
    logger.warn('could not report an attachmentService resolution failure to telemetry', { err: telemetryError })
  }
}

/**
 * The attachments module is optional: an unregistered service means the
 * deployment ships no attachments. Any other resolution failure is a broken
 * registration, still treated as unavailable but reported so it stays visible.
 */
export function resolveAttachmentService(container: { resolve: (name: string) => unknown }): AttachmentService | null {
  try {
    return container.resolve('attachmentService') as AttachmentService
  } catch (error) {
    if (!isAttachmentServiceNotRegistered(error)) reportAttachmentServiceFailure(error)
    return null
  }
}

type DescribedOutboundAttachment = { fileName: string; mimeType: string; fileSize: number }

/**
 * Describe every ref as the actor, in input order. `describeManyScoped` loads
 * them in one batch; a service override without it falls back to one
 * `describeScoped` per ref, or to `readScoped` (reading the bytes) when it has
 * neither optional method.
 */
async function describeOutboundAttachments(
  attachmentService: AttachmentService,
  auth: NonNullable<AuthContext>,
  refs: OutboundAttachmentRef[],
): Promise<DescribedOutboundAttachment[]> {
  if (attachmentService.describeManyScoped) {
    return attachmentService.describeManyScoped({
      auth,
      items: refs.map((ref) => ({ attachmentId: ref.attachmentId, expectedOwner: ref.owner })),
    })
  }
  const described: DescribedOutboundAttachment[] = []
  for (const ref of refs) {
    if (attachmentService.describeScoped) {
      described.push(await attachmentService.describeScoped({ attachmentId: ref.attachmentId, auth, expectedOwner: ref.owner }))
      continue
    }
    const file = await attachmentService.readScoped({
      attachmentId: ref.attachmentId,
      auth,
      expectedOwner: ref.owner,
      forceDownload: true,
    })
    described.push({ fileName: file.fileName, mimeType: file.mimeType, fileSize: file.buffer.byteLength })
  }
  return described
}

/**
 * Validate the actor's attachment references before anything is persisted:
 * the adapter must ship files, every file must be readable by the actor and
 * owned by the record the caller named, its stored (content-sniffed) MIME type
 * must be one the adapter sends, and the files must fit the size limits.
 * Any miss is reported as `attachment_not_found`, never revealing whether the
 * id exists elsewhere.
 */
export async function validateOutboundAttachments(input: {
  container: { resolve: (name: string) => unknown }
  scope: OutboundAttachmentScope
  refs: OutboundAttachmentRef[]
  capabilities: ChannelCapabilities
}): Promise<ValidateOutboundAttachmentsResult> {
  const { refs, capabilities } = input
  if (refs.length === 0) return { ok: true, stored: [] }
  if (!capabilities.fileSharing) return fail('attachments_unsupported')
  if (refs.length > OUTBOUND_ATTACHMENTS_MAX_COUNT) return fail('too_many_attachments')
  if (new Set(refs.map((ref) => ref.attachmentId)).size !== refs.length) return fail('duplicate_attachment')

  const attachmentService = resolveAttachmentService(input.container)
  if (!attachmentService) return fail('attachments_unsupported')

  const filenames: Array<string | undefined> = []
  for (const ref of refs) {
    if (ref.filename === undefined) {
      filenames.push(undefined)
      continue
    }
    const parsedName = attachmentFilenameSchema.safeParse(ref.filename)
    if (!parsedName.success) return fail('attachment_type_not_allowed')
    filenames.push(parsedName.data)
  }

  let describedFiles: DescribedOutboundAttachment[]
  try {
    describedFiles = await describeOutboundAttachments(attachmentService, buildActorAuth(input.scope), refs)
  } catch (error) {
    if (isAttachmentRefused(error)) return fail('attachment_not_found')
    throw error
  }

  const perFileLimit = capabilities.maxFileSize ?? totalLimitBytes(capabilities)
  let totalBytes = 0
  const stored: StoredOutboundAttachment[] = []
  for (const [index, ref] of refs.entries()) {
    const filename = filenames[index]
    const described = describedFiles[index]
    if (!isAllowedMimeType(capabilities, described.mimeType)) return fail('attachment_type_not_allowed')
    // A display-name override renames the file but never changes its type.
    if (filename && getAttachmentExtension(filename) !== getAttachmentExtension(described.fileName)) {
      return fail('attachment_type_not_allowed')
    }
    if (described.fileSize > perFileLimit) return fail('attachments_too_large', perFileLimit)
    totalBytes += described.fileSize
    if (totalBytes > totalLimitBytes(capabilities)) {
      return fail('attachments_too_large', totalLimitBytes(capabilities))
    }
    stored.push({
      attachmentId: ref.attachmentId,
      owner: { entityId: ref.owner.entityId, recordId: ref.owner.recordId },
      ...(filename ? { filename } : {}),
    })
  }
  return { ok: true, stored }
}

/** Read the hub-owned references back from a link's `channelMetadata`. */
export function readStoredOutboundAttachments(metadata: Record<string, unknown> | undefined): StoredOutboundAttachment[] {
  const raw = metadata?.[OUTBOUND_ATTACHMENTS_METADATA_KEY]
  if (raw === undefined || raw === null) return []
  const parsed = z.array(storedOutboundAttachmentSchema).max(OUTBOUND_ATTACHMENTS_MAX_COUNT).safeParse(raw)
  if (!parsed.success) throw new OutboundAttachmentDeliveryError('attachment_unavailable')
  return parsed.data
}

export function omitOutboundAttachments(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {}
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== OUTBOUND_ATTACHMENTS_METADATA_KEY))
}

/**
 * Read the stored references' bytes for delivery, as the channel owner the
 * facade authorized, pinned to the owner recorded at send time. The limits are
 * re-checked against the bytes actually read.
 */
export async function loadOutboundAttachments(input: {
  container: { resolve: (name: string) => unknown }
  scope: OutboundAttachmentScope
  stored: StoredOutboundAttachment[]
  capabilities: ChannelCapabilities
}): Promise<NormalizedAttachment[]> {
  const { stored, capabilities } = input
  if (stored.length === 0) return []
  if (!capabilities.fileSharing) throw new OutboundAttachmentDeliveryError('attachments_unsupported')
  const attachmentService = resolveAttachmentService(input.container)
  if (!attachmentService) throw new OutboundAttachmentDeliveryError('attachment_unavailable')

  const auth = buildActorAuth(input.scope)
  const perFileLimit = capabilities.maxFileSize ?? totalLimitBytes(capabilities)
  let totalBytes = 0
  const out: NormalizedAttachment[] = []
  for (const ref of stored) {
    let file
    try {
      file = await attachmentService.readScoped({
        attachmentId: ref.attachmentId,
        auth,
        expectedOwner: ref.owner,
        forceDownload: true,
      })
    } catch (error) {
      if (!isAttachmentRefused(error)) throw error
      if (await isAttachmentStillDescribable(attachmentService, ref, auth)) throw new OutboundAttachmentStorageError()
      throw new OutboundAttachmentDeliveryError('attachment_unavailable')
    }
    if (!isAllowedMimeType(capabilities, file.mimeType)) {
      throw new OutboundAttachmentDeliveryError('attachment_unavailable')
    }
    const byteLength = file.buffer.byteLength
    totalBytes += byteLength
    if (byteLength > perFileLimit || totalBytes > totalLimitBytes(capabilities)) {
      throw new OutboundAttachmentDeliveryError('attachments_too_large')
    }
    out.push({
      url: '',
      mimeType: file.mimeType,
      fileName: ref.filename ?? file.fileName,
      fileSize: byteLength,
      content: file.buffer,
    })
  }
  return out
}

/**
 * After `readScoped` refused a file, tell a missing or re-parented file apart
 * from bytes the storage could not return: `describeScoped` runs the same
 * checks without touching storage. A service without it keeps the refusal.
 */
async function isAttachmentStillDescribable(
  attachmentService: AttachmentService,
  ref: StoredOutboundAttachment,
  auth: NonNullable<AuthContext>,
): Promise<boolean> {
  if (!attachmentService.describeScoped) return false
  try {
    await attachmentService.describeScoped({ attachmentId: ref.attachmentId, auth, expectedOwner: ref.owner })
    return true
  } catch (error) {
    if (isAttachmentRefused(error)) return false
    throw error
  }
}

/**
 * The bytes an adapter should send for an outbound attachment: the hub-read
 * `content`, or a `data:` URL decoded in place. A remote URL is refused so an
 * adapter can never be turned into a fetcher.
 */
export function resolveOutboundAttachmentBytes(attachment: NormalizedAttachment): Uint8Array {
  if (attachment.content) return attachment.content
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(attachment.url ?? '')
  if (!match) throw new Error('[internal] outbound attachment has no content and no data: URL')
  const [, base64Flag, payload] = match
  return base64Flag ? Buffer.from(payload, 'base64') : decodePercentEncodedBytes(payload)
}

/**
 * RFC 2397 percent escapes stand for bytes, not UTF-8 text, so `%FF` decodes
 * to the byte 0xFF instead of failing or being re-encoded.
 */
function decodePercentEncodedBytes(payload: string): Buffer {
  if (/%(?![0-9a-f]{2})/i.test(payload)) {
    throw new Error('[internal] outbound attachment data: URL has a malformed percent escape')
  }
  return Buffer.concat(
    payload
      .split(/(%[0-9a-f]{2})/i)
      .map((part) => (part.startsWith('%') ? Buffer.of(Number.parseInt(part.slice(1), 16)) : Buffer.from(part, 'utf-8'))),
  )
}
