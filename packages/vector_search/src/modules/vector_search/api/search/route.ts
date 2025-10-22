import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { VectorSearchService } from '../../services/vectorSearchService'

const requestSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(20).optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['vector_search.search'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query payload' }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const service = resolve('vectorSearchService') as VectorSearchService
  const items = await service.search(parsed.data.query, {
    organizationId: auth.orgId,
    tenantId: auth.tenantId ?? null,
    limit: parsed.data.limit ?? 8,
  })

  return NextResponse.json({
    items,
    embeddingReady: service.hasEmbeddingSupport(),
  })
}
