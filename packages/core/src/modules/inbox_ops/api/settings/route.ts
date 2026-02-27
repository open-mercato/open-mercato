import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxSettings } from '../../data/entities'
import { updateSettingsSchema } from '../../data/validators'
import { resolveRequestContext, handleRouteError } from '../routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.settings.manage'] },
  PATCH: { requireAuth: true, requireFeatures: ['inbox_ops.settings.manage'] },
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
        workingLanguage: settings.workingLanguage,
      } : null,
    })
  } catch (err) {
    return handleRouteError(err, 'load settings')
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)

    const body = await req.json()
    const parsed = updateSettingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

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

    if (!settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 })
    }

    if (parsed.data.workingLanguage !== undefined) {
      settings.workingLanguage = parsed.data.workingLanguage
    }
    if (parsed.data.isActive !== undefined) {
      settings.isActive = parsed.data.isActive
    }

    await ctx.em.flush()

    return NextResponse.json({
      ok: true,
      settings: {
        id: settings.id,
        inboxAddress: settings.inboxAddress,
        isActive: settings.isActive,
        workingLanguage: settings.workingLanguage,
      },
    })
  } catch (err) {
    return handleRouteError(err, 'update settings')
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
    PATCH: {
      summary: 'Update tenant inbox configuration',
      description: 'Updates working language and/or active status',
      responses: [
        { status: 200, description: 'Updated settings' },
        { status: 404, description: 'Settings not found' },
      ],
    },
  },
}
