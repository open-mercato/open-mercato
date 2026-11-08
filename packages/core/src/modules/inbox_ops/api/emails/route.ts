import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxEmail } from '../../data/entities'
import { emailListQuerySchema } from '../../data/validators'
import { resolveRequestContext, UnauthorizedError } from '../routeHelpers'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { canViewEmailContent, serializeInboxEmailListItem } from './response'
import { resolveInboundAttachmentsRetryable } from '../../lib/inboundAttachmentReprocess'

const logger = createLogger('inbox_ops').child({ component: 'emails' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.log.view'] },
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const url = new URL(req.url)
    const query = emailListQuerySchema.parse({
      status: url.searchParams.get('status') || undefined,
      page: url.searchParams.get('page') || undefined,
      pageSize: url.searchParams.get('pageSize') || undefined,
    })

    const ctx = await resolveRequestContext(req)

    const where: Record<string, unknown> = {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
    }

    if (query.status) {
      where.status = query.status
    }

    const offset = (query.page - 1) * query.pageSize
    const includeContent = await canViewEmailContent(ctx)

    const [items, total] = await findAndCountWithDecryption(
      ctx.em,
      InboxEmail,
      where,
      {
        limit: query.pageSize,
        offset,
        orderBy: { receivedAt: 'DESC' },
      },
      ctx.scope,
    )

    // One ledger query for the page, and none for callers who would get it redacted.
    const retryable = includeContent
      ? await resolveInboundAttachmentsRetryable(ctx.em, ctx.scope, items)
      : new Map<string, boolean>()

    return NextResponse.json({
      items: items.map((email) => serializeInboxEmailListItem(email, includeContent, {
        attachmentsRetryable: retryable.get(email.id) ?? false,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: translate('inbox_ops.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    logger.error('Failed to list emails', { err })
    return NextResponse.json({ error: translate('inbox_ops.errors.emailsListFailed', 'Failed to list emails') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Emails',
  methods: {
    GET: {
      summary: 'List received emails',
      description: 'Processing log of all received emails. Each item carries `attachmentsStatus` (`pending`, `processing`, `completed`, or `null` for an email without attachment ingest) and the computed `attachmentsRetryable` (the ingest is `pending` or `processing`, or at least one part failed with `ingest_timeout`, `quota_exceeded` or `partition_unavailable`); both, like the other content fields, are `null` for callers without `inbox_ops.proposals.view`.',
      responses: [
        { status: 200, description: 'Paginated list of emails' },
      ],
    },
  },
}
