import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxEmail } from '../../data/entities'
import { emailListQuerySchema } from '../../data/validators'

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

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const auth = container.resolve('auth') as any

    const where: Record<string, unknown> = {
      organizationId: auth.organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
    }

    if (query.status) {
      where.status = query.status
    }

    const offset = (query.page - 1) * query.pageSize

    const [items, total] = await findAndCountWithDecryption(
      em,
      InboxEmail as any,
      where as any,
      {
        limit: query.pageSize,
        offset,
        orderBy: { receivedAt: 'DESC' } as any,
      },
      { tenantId: auth.tenantId, organizationId: auth.organizationId },
    )

    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    })
  } catch (err) {
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
