import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { HrdService } from '../../services/hrdService'
import { hrdRequestSchema } from '../../data/validators'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = hrdRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const hrdService = container.resolve<HrdService>('hrdService')
    const config = await hrdService.findActiveConfigByEmailDomain(parsed.data.email)

    if (!config) {
      return NextResponse.json({ hasSso: false })
    }

    return NextResponse.json({
      hasSso: true,
      configId: config.id,
      protocol: config.protocol,
    })
  } catch (err) {
    console.error('[SSO HRD] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'Home Realm Discovery',
  methods: {
    POST: {
      summary: 'Check if email domain has SSO configured',
      description: 'Given an email address, determines if the associated organization has an active SSO configuration. Called from the login page before authentication.',
      tags: ['SSO'],
      requestBody: {
        contentType: 'application/json',
        schema: hrdRequestSchema,
      },
      responses: [
        { status: 200, description: 'HRD result' },
      ],
      errors: [
        { status: 400, description: 'Invalid request' },
      ],
    },
  },
}
