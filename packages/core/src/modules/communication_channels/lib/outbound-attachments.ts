import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  getAttachmentExtension,
  hasDangerousExecutableExtension,
  type AttachmentService,
} from '@open-mercato/core/modules/attachments'
import type { ChannelCapabilities, NormalizedAttachment } from './adapter'
import { EMAIL_MAX_ATTACHMENT_BYTES } from './email-capabilities'

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

export function resolveAttachmentService(container: { resolve: (name: string) => unknown }): AttachmentService | null {
  try {
    return container.resolve('attachmentService') as AttachmentService
  } catch {
    return null
  }
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

  const auth = buildActorAuth(input.scope)
  // `describeScoped` is optional on the service contract; an override that
  // only implements `readScoped` still works, at the cost of reading the bytes.
  const describe = async (ref: OutboundAttachmentRef): Promise<{ fileName: string; mimeType: string; fileSize: number }> => {
    if (attachmentService.describeScoped) {
      return attachmentService.describeScoped({ attachmentId: ref.attachmentId, auth, expectedOwner: ref.owner })
    }
    const file = await attachmentService.readScoped({
      attachmentId: ref.attachmentId,
      auth,
      expectedOwner: ref.owner,
      forceDownload: true,
    })
    return { fileName: file.fileName, mimeType: file.mimeType, fileSize: file.buffer.byteLength }
  }
  const perFileLimit = capabilities.maxFileSize ?? totalLimitBytes(capabilities)
  let totalBytes = 0
  const stored: StoredOutboundAttachment[] = []
  for (const ref of refs) {
    let filename: string | undefined
    if (ref.filename !== undefined) {
      const parsedName = attachmentFilenameSchema.safeParse(ref.filename)
      if (!parsedName.success) return fail('attachment_type_not_allowed')
      filename = parsedName.data
    }
    let described
    try {
      described = await describe(ref)
    } catch (error) {
      if (isAttachmentRefused(error)) return fail('attachment_not_found')
      throw error
    }
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
      if (isAttachmentRefused(error)) throw new OutboundAttachmentDeliveryError('attachment_unavailable')
      throw error
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
