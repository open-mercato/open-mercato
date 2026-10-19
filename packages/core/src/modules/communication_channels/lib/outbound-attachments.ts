import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
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

const attachmentOwnerSchema = z.object({
  entityId: z.string().min(1).max(200),
  recordId: z.string().min(1).max(200),
})

export const outboundAttachmentRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('attachment'),
    attachmentId: z.string().uuid(),
    owner: attachmentOwnerSchema,
    filename: z.string().min(1).max(255).regex(/^[^\r\n]*$/).optional(),
  }),
])

export const outboundAttachmentRefsSchema = z.array(outboundAttachmentRefSchema).max(OUTBOUND_ATTACHMENTS_MAX_COUNT)

export type OutboundAttachmentRef = z.infer<typeof outboundAttachmentRefSchema>

const storedOutboundAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
  owner: attachmentOwnerSchema,
  filename: z.string().min(1).max(255).optional(),
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

function buildActorAuth(scope: OutboundAttachmentScope): NonNullable<AuthContext> {
  return { sub: scope.userId, userId: scope.userId, tenantId: scope.tenantId, orgId: scope.organizationId }
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
  if (!attachmentService?.describeScoped) return fail('attachments_unsupported')

  const auth = buildActorAuth(input.scope)
  const perFileLimit = capabilities.maxFileSize ?? OUTBOUND_ATTACHMENTS_MAX_TOTAL_BYTES
  let totalBytes = 0
  const stored: StoredOutboundAttachment[] = []
  for (const ref of refs) {
    let described
    try {
      described = await attachmentService.describeScoped({
        attachmentId: ref.attachmentId,
        auth,
        expectedOwner: ref.owner,
      })
    } catch {
      return fail('attachment_not_found')
    }
    if (!isAllowedMimeType(capabilities, described.mimeType)) return fail('attachment_type_not_allowed')
    if (described.fileSize > perFileLimit) return fail('attachments_too_large', perFileLimit)
    totalBytes += described.fileSize
    if (totalBytes > OUTBOUND_ATTACHMENTS_MAX_TOTAL_BYTES) {
      return fail('attachments_too_large', OUTBOUND_ATTACHMENTS_MAX_TOTAL_BYTES)
    }
    stored.push({
      attachmentId: ref.attachmentId,
      owner: { entityId: ref.owner.entityId, recordId: ref.owner.recordId },
      ...(ref.filename ? { filename: ref.filename } : {}),
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
  const perFileLimit = capabilities.maxFileSize ?? OUTBOUND_ATTACHMENTS_MAX_TOTAL_BYTES
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
    } catch {
      throw new OutboundAttachmentDeliveryError('attachment_unavailable')
    }
    if (!isAllowedMimeType(capabilities, file.mimeType)) {
      throw new OutboundAttachmentDeliveryError('attachment_unavailable')
    }
    const byteLength = file.buffer.byteLength
    totalBytes += byteLength
    if (byteLength > perFileLimit || totalBytes > OUTBOUND_ATTACHMENTS_MAX_TOTAL_BYTES) {
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
  return base64Flag ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf-8')
}
