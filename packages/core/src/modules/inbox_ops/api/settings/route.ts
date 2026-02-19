import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxSettings } from '../../data/entities'
import { resolveRequestContext, UnauthorizedError } from '../routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.settings.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)

    const settings = await findOneWithDecryption(
      ctx.em,
      InboxSettings,
      {
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      undefined,
      ctx.scope,
    )

    return NextResponse.json({
      settings: settings ? {
        id: settings.id,
        inboxAddress: settings.inboxAddress,
        isActive: settings.isActive,
      } : null,
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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
