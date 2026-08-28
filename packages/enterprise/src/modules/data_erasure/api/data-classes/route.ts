import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolvePrivacyApiContext } from '../context'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_erasure.view'] },
}

export async function GET(request: Request) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  return NextResponse.json({ items: context.privacyGovernanceService.listDataClasses() })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Privacy data classes',
  methods: { GET: { summary: 'List registered privacy data classes' } },
}
