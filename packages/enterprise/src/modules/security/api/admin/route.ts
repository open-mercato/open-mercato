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
  summary: 'Admin security routes',
  methods: {
    GET: { summary: 'Get admin security data' },
    POST: { summary: 'Manage admin security actions' },
  },
}
