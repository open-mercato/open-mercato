import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { collectPlatformMap } from '@open-mercato/shared/lib/introspection/registry'
import { buildRuntimeIntrospectionContext } from '@open-mercato/shared/lib/introspection/runtime-context'
import { isPlatformMapEnabled } from '../../lib/gating'

const logger = createLogger('platform').child({ component: 'inspect' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['platform.inspect.view'] },
} as const

export async function GET(req: Request) {
  if (!isPlatformMapEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const surface = url.searchParams.get('surface') ?? undefined
  const tierRaw = url.searchParams.get('tier')
  const maxTier = tierRaw === '1' || tierRaw === '2' || tierRaw === '3' ? Number(tierRaw) as 1 | 2 | 3 : 2
  const surfaceIds = surface ? surface.split(',').map((entry) => entry.trim()).filter(Boolean) : undefined

  if (maxTier === 3 && !auth.tenantId) {
    return NextResponse.json({ error: 'Tenant scope required for tier 3' }, { status: 400 })
  }

  try {
    const container = await createRequestContainer()
    const em = maxTier === 3 ? container.resolve('em') : undefined

    const ctx = await buildRuntimeIntrospectionContext({
      container,
      em,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      surfaceIds,
    })

    const map = await collectPlatformMap(ctx, {
      maxTier,
      surfaceIds,
      generatedAt: new Date().toISOString(),
    })

    return NextResponse.json(map)
  } catch (error) {
    logger.error('Failed to build platform map', { err: error })
    return NextResponse.json({ error: 'Failed to load platform map' }, { status: 500 })
  }
}

export const openApi = {
  tag: 'Platform',
  summary: 'Platform map introspection',
  methods: {
    GET: {
      summary: 'Return the wired platform map for the current tenant scope',
    },
  },
} as const
