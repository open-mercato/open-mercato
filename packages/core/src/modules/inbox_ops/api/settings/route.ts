import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxSettings } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.settings.manage'] },
}

export async function GET() {
  try {
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const auth = container.resolve('auth') as any

    const settings = await em.findOne(InboxSettings, {
      organizationId: auth.organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })

    return NextResponse.json({
      settings: settings ? {
        id: settings.id,
        inboxAddress: settings.inboxAddress,
        isActive: settings.isActive,
      } : null,
    })
  } catch (err) {
    console.error('[inbox_ops:settings] Error:', err)
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Settings',
  methods: {
    GET: {
      summary: 'Get tenant inbox configuration',
      description: 'Returns the forwarding address and configuration for this tenant',
      responses: [
        { status: 200, description: 'Inbox settings' },
      ],
    },
  },
}
