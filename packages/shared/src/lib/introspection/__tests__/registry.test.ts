import { collectPlatformMap, getSurfaceProviderIds, getSurfaceProviders } from '../registry'
import { PLATFORM_MAP_SCHEMA_VERSION } from '../types'
import type { IntrospectionContext } from '../types'
import { renderPlatformMapHuman } from '../render'

function makeContext(overrides: Partial<IntrospectionContext> = {}): IntrospectionContext {
  return {
    modules: [
      {
        id: 'example',
        features: [{ id: 'example.view', title: 'View', module: 'example' }],
        subscribers: [
          { id: 'sub-ok', event: 'example.todo.created', handler: async () => {} },
          { id: 'sub-orphan', event: 'missing.event', handler: async () => {} },
        ],
      },
    ],
    snapshot: {
      notificationTypes: [],
      aiToolConfigEntries: [],
      messageTypes: [],
    },
    ...overrides,
  }
}

describe('collectPlatformMap', () => {
  it('returns schemaVersion and requested surfaces', async () => {
    const map = await collectPlatformMap(makeContext(), {
      surfaceIds: ['module', 'acl-feature'],
      generatedAt: '2026-06-29T00:00:00.000Z',
    })

    expect(map.schemaVersion).toBe(PLATFORM_MAP_SCHEMA_VERSION)
    expect(map.generatedAt).toBe('2026-06-29T00:00:00.000Z')
    expect(map.surfaces.module.rows).toEqual([
      expect.objectContaining({ id: 'example' }),
    ])
    expect(map.surfaces['acl-feature'].rows).toEqual([
      expect.objectContaining({ id: 'example.view', moduleId: 'example' }),
    ])
  })

  it('flags orphan subscribers and dead events in event-flow', async () => {
    const map = await collectPlatformMap(makeContext(), {
      surfaceIds: ['event-flow'],
    })

    const rows = map.surfaces['event-flow'].rows
    expect(rows.some((row) => row.status === 'orphan-subscriber' && row.eventId === 'missing.event')).toBe(true)
  })

  it('caps collection at maxTier', async () => {
    const map = await collectPlatformMap(makeContext(), {
      maxTier: 1,
    })
    expect(map.surfaces['di-key']).toBeUndefined()
    expect(map.surfaces['acl-role-grant']).toBeUndefined()
  })
})

describe('surface catalog sync', () => {
  it('matches built-in provider ids', async () => {
    const providerIds = (await getSurfaceProviders()).map((provider) => provider.id).sort()
    const catalogIds = getSurfaceProviderIds().sort()
    expect(catalogIds).toEqual(providerIds)
  })
})

describe('renderPlatformMapHuman', () => {
  it('renders a surface table header', async () => {
    const map = await collectPlatformMap(makeContext(), { surfaceIds: ['module'] })
    const providers = await getSurfaceProviders()
    const providersById = new Map(providers.map((provider) => [provider.id, provider]))
    const output = renderPlatformMapHuman(map, providersById)
    expect(output).toContain('Modules [module]')
    expect(output).toContain('id')
    expect(output).toContain('example')
  })
})
