import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxEmail } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.log.view'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const segments = url.pathname.split('/')
    const id = segments[segments.indexOf('emails') + 1]

    if (!id) {
      return NextResponse.json({ error: 'Missing email ID' }, { status: 400 })
    }

    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth?.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const email = await findOneWithDecryption(
      em,
      InboxEmail as any,
      {
        id,
        organizationId: auth.orgId,
        tenantId: auth.tenantId,
        deletedAt: null,
      } as any,
      undefined,
      { tenantId: auth.tenantId, organizationId: auth.orgId },
    )

    if (!email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 })
    }

    return NextResponse.json({ email })
  } catch (err) {
    console.error('[inbox_ops:emails:detail] Error:', err)
    return NextResponse.json({ error: 'Failed to load email' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Email detail',
  methods: {
    GET: {
      summary: 'Get email detail with parsed thread',
      responses: [
        { status: 200, description: 'Email detail' },
        { status: 404, description: 'Email not found' },
      ],
    },
  },
}
