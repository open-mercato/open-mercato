import {
  getRouteManifestShardKey,
  renderRouteManifestShardOutputs,
  renderRouteMetadataOutput,
} from '../route-manifest-shards'

describe('route manifest shards', () => {
  it('groups static request prefixes and preserves dynamic-prefix fallbacks', () => {
    expect(getRouteManifestShardKey('api', '/customers/[id]')).toBe('customers')
    expect(getRouteManifestShardKey('backend', '/backend/sales/orders')).toBe('sales')
    expect(getRouteManifestShardKey('backend', '/backend/[tenant]/settings')).toBe('__dynamic')
    expect(getRouteManifestShardKey('api', '/')).toBe('__root')
  })

  it('renders a small loader graph with exact and dynamic shards', () => {
    const outputs = renderRouteManifestShardOutputs('api', [
      { path: '/customers', declaration: `{ moduleId: 'customers' } as any` },
      { path: '/sales/orders', declaration: `{ moduleId: 'sales' } as any` },
      { path: '/[module]/health', declaration: `{ moduleId: 'dynamic' } as any` },
    ])
    const loader = outputs.find((entry) => entry.fileName === 'api-route-shards.generated.ts')?.content ?? ''

    expect(outputs.filter((entry) => entry.fileName.includes('route-shard.'))).toHaveLength(3)
    expect(loader).toContain(`case "customers":`)
    expect(loader).toContain(`case "sales":`)
    expect(loader).toContain(`const dynamicShard = await loadShard("__dynamic")`)
    expect(loader).toContain(`export const apiRouteFacades`)
    expect(loader).toContain(`loadApiRouteManifestByOrdinal(ordinal)`)
    expect(loader).not.toContain("moduleId: 'customers'")
  })

  it('retains global route order when exact and dynamic entries interleave', () => {
    const outputs = renderRouteManifestShardOutputs('api', [
      { path: '/customers/new', declaration: `{ path: '/customers/new' } as any` },
      { path: '/[module]/health', declaration: `{ path: '/[module]/health' } as any` },
      { path: '/customers/[id]', declaration: `{ path: '/customers/[id]' } as any` },
      { path: '/', declaration: `{ path: '/' } as any` },
    ])
    const customerShard = outputs.find((entry) => entry.content.includes(`/customers/new`))?.content ?? ''
    const dynamicShard = outputs.find((entry) => entry.content.includes(`/[module]/health`))?.content ?? ''
    const loader = outputs.find((entry) => entry.fileName === 'api-route-shards.generated.ts')?.content ?? ''

    expect(customerShard).toContain('export const routeOrders = [0, 2]')
    expect(dynamicShard).toContain('export const routeOrders = [1]')
    expect(loader).toContain(`case "__root":`)
    expect(loader).toContain(`.sort((a, b) => a.order - b.order)`)
    expect(loader).toContain(`const ROUTE_SHARD_KEYS = ["customers","__dynamic","customers","__root"]`)
  })

  it('renders metadata without load functions while retaining metadata imports', () => {
    const output = renderRouteMetadataOutput('backend', [{
      path: '/backend/settings',
      declaration: `{ moduleId: 'settings', ...resolvePageRouteMetadata('/backend/settings', META.metadata) }`,
      imports: [`import * as META from '@app/settings/meta'`],
    }])

    expect(output.fileName).toBe('backend-route-metadata.generated.ts')
    expect(output.content).toContain(`import * as META from '@app/settings/meta'`)
    expect(output.content).toContain(`Omit<BackendRouteManifestEntry, 'load'>`)
    expect(output.content).not.toContain('load: async')
  })
})
