import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { InboxEmail, InboxEmailAttachment } from '../../../../data/entities'
import {
  inboxEmailAttachmentListResponseSchema,
  inboxEmailIdParamsSchema,
  type InboxEmailAttachmentListItem,
  type InboxEmailAttachmentListResponse,
} from '../../../../data/validators'
import { INBOUND_ATTACHMENT_LEDGER_MAX_ROWS } from '../../../../lib/inboundAttachments'
import { extractPathSegment, resolveRequestContext, UnauthorizedError } from '../../../routeHelpers'
import { resolveErrorTranslate } from '../../../../lib/errorTranslate'

const logger = createLogger('inbox_ops').child({ component: 'email-attachments' })

/**
 * Rows the list returns at most. The webhook records at most {@link INBOUND_ATTACHMENT_LEDGER_MAX_ROWS}
 * rows beyond an email's `pending` parts, so this bounds the response even for an unusual ledger.
 */
export const INBOX_EMAIL_ATTACHMENT_LIST_LIMIT = 2 * INBOUND_ATTACHMENT_LEDGER_MAX_ROWS

/**
 * Columns the list reads: the returned ones, plus `declaredMimeType` (the type shown while no sniffed
 * `mimeType` exists) and `createdAt` (the sort key). The encrypted `extractedText` is left out, so it
 * is never loaded or decrypted; only the encrypted `fileName` is.
 */
export const INBOX_EMAIL_ATTACHMENT_LIST_FIELDS = [
  'id',
  'partKey',
  'fileName',
  'mimeType',
  'declaredMimeType',
  'sizeBytes',
  'disposition',
  'status',
  'reason',
  'attachmentId',
  'createdAt',
] as const satisfies ReadonlyArray<keyof InboxEmailAttachment>

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

function toListItem(row: InboxEmailAttachment): InboxEmailAttachmentListItem {
  const attachmentId = row.attachmentId ?? null
  return {
    id: row.id,
    partKey: row.partKey,
    fileName: row.fileName ?? null,
    mimeType: row.mimeType ?? row.declaredMimeType ?? null,
    sizeBytes: row.sizeBytes ?? null,
    disposition: row.disposition,
    status: row.status,
    reason: row.reason ?? null,
    attachmentId,
    url: row.status === 'stored' && attachmentId ? `/api/attachments/file/${attachmentId}` : null,
  }
}

export async function GET(req: Request) {
  try {
    const translate = await resolveErrorTranslate()
    const ctx = await resolveRequestContext(req)
    const params = inboxEmailIdParamsSchema.safeParse({ id: extractPathSegment(new URL(req.url), 'emails') })
    const notFound = () => NextResponse.json(
      { error: translate('inbox_ops.errors.emailNotFound', 'Email not found') },
      { status: 404 },
    )
    if (!params.success) return notFound()

    // Existence check only: loading just the id keeps the encrypted body, subject and addresses undecrypted.
    const email = await findOneWithDecryption(
      ctx.em,
      InboxEmail,
      { id: params.data.id, organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null },
      { fields: ['id'] },
      ctx.scope,
    )
    if (!email) return notFound()

    const rows = await findWithDecryption(
      ctx.em,
      InboxEmailAttachment,
      {
        inboxEmailId: email.id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
        $or: [{ reason: null }, { reason: { $ne: 'inline_decoration' } }],
      },
      { fields: [...INBOX_EMAIL_ATTACHMENT_LIST_FIELDS], orderBy: { createdAt: 'asc', id: 'asc' }, limit: INBOX_EMAIL_ATTACHMENT_LIST_LIMIT },
      ctx.scope,
    )

    const body: InboxEmailAttachmentListResponse = { items: rows.map(toListItem) }
    return NextResponse.json(body)
  } catch (err) {
    const translate = await resolveErrorTranslate()
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: translate('inbox_ops.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    logger.error('Failed to list email attachments', { err })
    return NextResponse.json(
      { error: translate('inbox_ops.errors.attachmentsLoadFailed', 'Failed to load email attachments') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Email attachments',
  methods: {
    GET: {
      summary: 'List the attachment parts of an inbound email',
      description: 'Ledger of the email\'s attachment parts with their ingestion status and reason, oldest ledger row first (rows recorded together have no guaranteed relative order). Inline decorations (signature logos, tracking pixels) and extracted text are never returned. Stored files are downloaded through the returned url. At most 200 rows are returned.',
      responses: [
        { status: 200, description: 'Attachment parts of the email', schema: inboxEmailAttachmentListResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Email not found' },
        { status: 500, description: 'Failed to load email attachments' },
      ],
    },
  },
}
