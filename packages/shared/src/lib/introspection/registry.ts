import type {
  CollectPlatformMapOptions,
  IntrospectionContext,
  PlatformMap,
  SurfaceProvider,
  SurfaceTier,
} from './types'
import { PLATFORM_MAP_SCHEMA_VERSION } from './types'
import { SURFACE_CATALOG } from './surface-catalog'

let cachedProviders: SurfaceProvider[] | null = null

async function loadBuiltInProviders(): Promise<SurfaceProvider[]> {
  if (!cachedProviders) {
    const mod = await import('./providers')
    cachedProviders = mod.builtInSurfaceProviders
  }
  return cachedProviders
}

export function registerSurfaceProvider(provider: SurfaceProvider): void {
  void loadBuiltInProviders().then((providers) => {
    cachedProviders = [...providers.filter((entry) => entry.id !== provider.id), provider]
  })
}

export async function getSurfaceProviders(): Promise<SurfaceProvider[]> {
  return loadBuiltInProviders()
}

export function getSurfaceProviderIds(): string[] {
  return SURFACE_CATALOG.map((entry) => entry.id)
}

export async function getSurfaceProvider(id: string): Promise<SurfaceProvider | undefined> {
  const providers = await loadBuiltInProviders()
  return providers.find((provider) => provider.id === id)
}

async function resolveProviders(options: CollectPlatformMapOptions): Promise<SurfaceProvider[]> {
  const maxTier = options.maxTier ?? 2
  const providers = (await loadBuiltInProviders()).filter((provider) => provider.tier <= maxTier)

  if (options.surfaceIds?.length) {
    const allowed = new Set(options.surfaceIds)
    return providers.filter((provider) => allowed.has(provider.id)).sort((a, b) => a.id.localeCompare(b.id))
  }

  return providers.sort((a, b) => a.id.localeCompare(b.id))
}

export async function collectPlatformMap(
  ctx: IntrospectionContext,
  options: CollectPlatformMapOptions = {},
): Promise<PlatformMap> {
  const providers = await resolveProviders(options)
  const surfaces: PlatformMap['surfaces'] = {}

  for (const provider of providers) {
    const rows = await provider.collect(ctx)
    surfaces[provider.id] = {
      tier: provider.tier as SurfaceTier,
      rows,
    }
  }

  const hasTier3 = providers.some((provider) => provider.tier === 3)

  return {
    schemaVersion: PLATFORM_MAP_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    scope: hasTier3
      ? {
          tenantId: ctx.tenantId ?? null,
          organizationId: ctx.organizationId ?? null,
        }
      : null,
    surfaces,
  }
}
