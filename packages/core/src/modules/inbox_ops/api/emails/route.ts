import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxEmail } from '../../data/entities'
import { emailListQuerySchema } from '../../data/validators'
import { resolveRequestContext, UnauthorizedError } from '../routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.log.view'] },
}

export async function GET(req: Request) {
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

    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[inbox_ops:emails] Error:', err)
    return NextResponse.json({ error: 'Failed to list emails' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Emails',
  methods: {
    GET: {
      summary: 'List received emails',
      description: 'Processing log of all received emails',
      responses: [
        { status: 200, description: 'Paginated list of emails' },
      ],
    },
  },
}
