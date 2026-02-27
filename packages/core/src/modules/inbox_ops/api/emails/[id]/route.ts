import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxEmail } from '../../../data/entities'
import {
  resolveRequestContext,
  extractPathSegment,
  UnauthorizedError,
} from '../../routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.log.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const id = extractPathSegment(url, 'emails')

    if (!id) {
      return NextResponse.json({ error: 'Missing email ID' }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)

    const email = await findOneWithDecryption(
      ctx.em,
      InboxEmail,
      {
        id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      undefined,
      ctx.scope,
    )

    if (!email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 })
    }

    return NextResponse.json({ email })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[inbox_ops:emails:detail] Error:', err)
    return NextResponse.json({ error: 'Failed to load email' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const id = extractPathSegment(url, 'emails')

    if (!id) {
      return NextResponse.json({ error: 'Missing email ID' }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)

    const updated = await ctx.em.nativeUpdate(
      InboxEmail,
      {
        id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      { deletedAt: new Date() },
    )

    if (updated === 0) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[inbox_ops:emails:delete] Error:', err)
    return NextResponse.json({ error: 'Failed to delete email' }, { status: 500 })
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
    DELETE: {
      summary: 'Soft-delete an inbox email',
      responses: [
        { status: 200, description: 'Email deleted' },
        { status: 404, description: 'Email not found' },
      ],
    },
  },
}
