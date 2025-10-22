import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { VectorSearchService } from '../../services/vectorSearchService'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  query: z.string().trim().optional().default(''),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['vector_search.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const service = resolve('vectorSearchService') as VectorSearchService
  const data = await service.list({
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    query: parsed.data.query?.length ? parsed.data.query : undefined,
    organizationId: auth.orgId,
    tenantId: auth.tenantId ?? null,
  })

  return NextResponse.json({
    items: data.items,
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
    embeddingReady: service.hasEmbeddingSupport(),
  })
}
