import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposal } from '../../data/entities'
import { proposalListQuerySchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = proposalListQuerySchema.parse({
      status: url.searchParams.get('status') || undefined,
      search: url.searchParams.get('search') || undefined,
      page: url.searchParams.get('page') || undefined,
      pageSize: url.searchParams.get('pageSize') || undefined,
    })

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const auth = container.resolve('auth') as {
      tenantId?: string | null
      organizationId?: string | null
    }
    if (!auth.tenantId || !auth.organizationId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const where: Record<string, unknown> = {
      organizationId: auth.organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
      isActive: true,
    }

    if (query.status) {
      where.status = query.status
    }
    if (query.search) {
      where.$or = [
        {
          summary: { $ilike: `%${query.search}%` },
        },
      ]
    }

    const offset = (query.page - 1) * query.pageSize

    const [items, total] = await findAndCountWithDecryption(
      em,
      InboxProposal as any,
      where as any,
      {
        limit: query.pageSize,
        offset,
        orderBy: { createdAt: 'DESC' } as any,
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
    console.error('[inbox_ops:proposals] Error listing proposals:', err)
    return NextResponse.json({ error: 'Failed to list proposals' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Proposals',
  methods: {
    GET: {
      summary: 'List proposals',
      description: 'List inbox proposals with optional status filter and pagination',
      responses: [
        { status: 200, description: 'Paginated list of proposals' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
