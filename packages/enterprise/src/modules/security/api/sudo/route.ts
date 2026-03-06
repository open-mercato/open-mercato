import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export async function GET() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 })
}

export async function POST() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Security',
  summary: 'Sudo challenge routes',
  methods: {
    GET: { summary: 'Get sudo challenge state' },
    POST: { summary: 'Verify sudo challenge' },
  },
}
