import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { VectorIndexService } from '@open-mercato/vector'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['vector.search'] },
}

function parseLimit(value: string | null): number {
  if (!value) return 10
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 10
  return Math.min(parsed, 50)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const query = (url.searchParams.get('q') || '').trim()
  const limit = parseLimit(url.searchParams.get('limit'))
  if (!query) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  let service: VectorIndexService
  try {
    service = container.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    return NextResponse.json({ error: 'Vector index unavailable' }, { status: 503 })
  }

  try {
    const results = await service.search({
      query,
      limit,
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    })
    return NextResponse.json({ results })
  } catch (error: any) {
    if (error instanceof Error && /Embedding service unavailable/i.test(error.message)) {
      return NextResponse.json({ error: 'Embedding service unavailable. Configure OPENAI_API_KEY.' }, { status: 503 })
    }
    console.error('[vector.search] failed', error)
    return NextResponse.json({ error: 'Vector search failed' }, { status: 500 })
  }
}
