import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { operationListQuerySchema } from '../../data/validators'
import { resolvePrivacyApiContext } from '../context'
import { serializeOperation } from '../serialize'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_erasure.view'] },
}

export async function GET(request: Request) {
  const context = await resolvePrivacyApiContext(request)
  if (context instanceof Response) return context
  const url = new URL(request.url)
  const parsed = operationListQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid operation query', details: parsed.error.flatten() }, { status: 400 })
  }
  const result = await context.privacyGovernanceService.listOperations(context.scope, parsed.data)
  return NextResponse.json({ ...result, items: result.items.map(serializeOperation) })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Erasure',
  summary: 'Privacy operations',
  methods: { GET: { summary: 'List privacy operations' } },
}
