import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { InboxEmail, InboxEmailAttachment } from '../../../../data/entities'
import {
  inboxEmailAttachmentListResponseSchema,
  inboxEmailIdParamsSchema,
  type InboxEmailAttachmentListItem,
  type InboxEmailAttachmentListResponse,
} from '../../../../data/validators'
import { extractPathSegment, resolveRequestContext, UnauthorizedError } from '../../../routeHelpers'

const logger = createLogger('inbox_ops').child({ component: 'email-attachments' })

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
    const ctx = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const params = inboxEmailIdParamsSchema.safeParse({ id: extractPathSegment(new URL(req.url), 'emails') })
    const notFound = () => NextResponse.json(
      { error: translate('inbox_ops.errors.emailNotFound', 'Email not found') },
      { status: 404 },
    )
    if (!params.success) return notFound()

    const email = await findOneWithDecryption(
      ctx.em,
      InboxEmail,
      { id: params.data.id, organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null },
      undefined,
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
      { orderBy: { createdAt: 'asc', id: 'asc' } },
      ctx.scope,
    )

    const body: InboxEmailAttachmentListResponse = { items: rows.map(toListItem) }
    return NextResponse.json(body)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('Failed to list email attachments', { err })
    return NextResponse.json({ error: 'Failed to load email attachments' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Email attachments',
  methods: {
    GET: {
      summary: 'List the attachment parts of an inbound email',
      description: 'Ledger of the email\'s attachment parts with their ingestion status and reason, oldest ledger row first (rows recorded together have no guaranteed relative order). Inline decorations (signature logos, tracking pixels) and extracted text are never returned. Stored files are downloaded through the returned url.',
      responses: [
        { status: 200, description: 'Attachment parts of the email', schema: inboxEmailAttachmentListResponseSchema },
        { status: 404, description: 'Email not found' },
      ],
    },
  },
}
