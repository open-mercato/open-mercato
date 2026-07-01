import { createResolver } from '../resolver'
import { bootstrapForIntrospection } from './bootstrap'
import { parseInspectArgv, resolveSurfaceFilter } from './args'
import { buildIntrospectionContext } from '@open-mercato/shared/lib/introspection/context'
import {
  collectPlatformMap,
  getSurfaceProviderIds,
  getSurfaceProviders,
} from '@open-mercato/shared/lib/introspection/registry'
import { renderPlatformMapHuman } from '@open-mercato/shared/lib/introspection/render'

export async function runInspect(argv: string[]): Promise<number> {
  const options = parseInspectArgv(argv)

  if (options.tier === 3 && !options.tenantId) {
    console.error('[internal] Tier 3 introspection requires --tenant <id>')
    return 1
  }

  const surfaceIds = resolveSurfaceFilter(options)
  if (surfaceIds?.length) {
    for (const surfaceId of surfaceIds) {
      if (!getSurfaceProviderIds().includes(surfaceId)) {
        const available = getSurfaceProviderIds().join(', ')
        console.error(`[internal] Unknown surface "${surfaceId}". Available: ${available}`)
        return 1
      }
    }
  }

  try {
    const resolver = createResolver()
    const appDir = resolver.getAppDir()
    const bootstrapData = await bootstrapForIntrospection(appDir, {
      surfaceIds,
      maxTier: options.tier,
    })

    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const em = options.tier === 3 ? container.resolve('em') : undefined

    const ctx = buildIntrospectionContext({
      bootstrapData,
      container,
      em,
      tenantId: options.tenantId ?? null,
      organizationId: options.organizationId ?? null,
    })

    const map = await collectPlatformMap(ctx, {
      maxTier: options.tier,
      surfaceIds,
      generatedAt: new Date().toISOString(),
    })

    if (options.json) {
      console.log(JSON.stringify(map, null, 2))
      return 0
    }

    const providers = await getSurfaceProviders()
    const providersById = new Map(providers.map((provider) => [provider.id, provider]))
    console.log(renderPlatformMapHuman(map, providersById))
    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[internal] mercato inspect failed: ${message}`)
    return 1
  }
}
