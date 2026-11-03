import { z } from 'zod'
import { defineAdapterModule, type AdapterModule } from '../../contract/adapter'
import { CONTRACT_VERSION } from '../../contract/version'
import { createFakeAdapter } from '../../testing/fakeAdapter'
import { createTestContext } from '../../testing/contract'
import { readAdapterManifest } from '../manifest'
import { instantiateAdapter, resolveAdapterModules } from '../registry'

const workingModule = defineAdapterModule({
  id: 'working',
  kind: 'api',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: z.object({ apiKey: z.string().min(1) }),
  createAdapter: (options) => createFakeAdapter({ id: 'working', results: [{ url: `https://x/${options.apiKey}` }] }),
})

describe('readAdapterManifest', () => {
  it('reads a well-formed manifest', () => {
    const result = readAdapterManifest({
      name: '@acme/web-research-brave',
      openMercato: { webResearchAdapter: { id: 'brave' } },
    })
    expect(result).toEqual({ packageName: '@acme/web-research-brave', manifest: { id: 'brave' } })
  })

  it('ignores a package that is not an adapter', () => {
    expect(readAdapterManifest({ name: 'lodash' })).toBeNull()
    expect(readAdapterManifest({ name: 'x', openMercato: {} })).toBeNull()
    expect(readAdapterManifest(null)).toBeNull()
  })

  it('reports a malformed manifest instead of ignoring it', () => {
    const result = readAdapterManifest({
      name: '@acme/broken',
      openMercato: { webResearchAdapter: { id: '' } },
    })
    expect(result).toMatchObject({ error: expect.stringContaining('@acme/broken') })
  })
})

describe('resolveAdapterModules', () => {
  it('accepts a valid descriptor and unwraps a default export', () => {
    const registry = resolveAdapterModules([
      { packageName: 'a', module: workingModule },
      { packageName: 'b', module: { default: { ...workingModule, id: 'other' } } },
    ])
    expect(registry.rejected).toEqual([])
    expect(registry.loaded.map((entry) => entry.module.id)).toEqual(['working', 'other'])
  })

  it('rejects a contract-version mismatch without throwing', () => {
    const registry = resolveAdapterModules([
      { packageName: 'stale', module: { ...workingModule, contractVersion: CONTRACT_VERSION + 1 } },
    ])
    expect(registry.loaded).toEqual([])
    expect(registry.rejected[0].reason).toContain('contract version')
  })

  it.each([
    ['not an object', 42],
    ['missing id', { ...workingModule, id: '' }],
    ['unknown kind', { ...workingModule, kind: 'telepathy' }],
    ['missing createAdapter', { ...workingModule, createAdapter: undefined }],
    ['missing optionsSchema', { ...workingModule, optionsSchema: undefined }],
  ])('rejects a descriptor that is %s', (_label, module) => {
    const registry = resolveAdapterModules([{ packageName: 'bad', module }])
    expect(registry.loaded).toEqual([])
    expect(registry.rejected).toHaveLength(1)
  })

  it('keeps the first package to claim an adapter id and rejects the duplicate', () => {
    const registry = resolveAdapterModules([
      { packageName: 'first', module: workingModule },
      { packageName: 'second', module: { ...workingModule } },
    ])
    expect(registry.loaded.map((entry) => entry.packageName)).toEqual(['first'])
    expect(registry.rejected[0].reason).toContain('already provided by first')
  })

  // The MCP server loads every module tool through one ESM graph, where a single
  // failed import drops all of them. One broken adapter must never do that.
  it('isolates a bad descriptor from the good ones in the same batch', () => {
    const registry = resolveAdapterModules([
      { packageName: 'broken', module: null },
      { packageName: 'fine', module: workingModule },
    ])
    expect(registry.loaded.map((entry) => entry.module.id)).toEqual(['working'])
    expect(registry.rejected.map((entry) => entry.packageName)).toEqual(['broken'])
  })
})

describe('instantiateAdapter', () => {
  const loaded = { packageName: 'pkg', module: workingModule as AdapterModule<unknown> }

  it('builds an adapter from valid options', () => {
    const result = instantiateAdapter(loaded, { apiKey: 'secret' })
    expect(result.error).toBeUndefined()
    expect(result.adapter.readiness().ready).toBe(true)
  })

  it('stands in an unavailable adapter when options do not validate', async () => {
    const result = instantiateAdapter(loaded, { apiKey: '' })
    expect(result.error).toContain('invalid options')
    const readiness = result.adapter.readiness()
    expect(readiness.ready).toBe(false)
    await expect(result.adapter.search({ query: 'x', limit: 5 }, createTestContext())).resolves.toMatchObject({
      status: 'unavailable',
    })
  })

  it('stands in an unavailable adapter when the constructor throws', () => {
    const exploding = {
      packageName: 'pkg',
      module: {
        ...workingModule,
        createAdapter: () => {
          throw new Error('boom')
        },
      } as AdapterModule<unknown>,
    }
    const result = instantiateAdapter(exploding, { apiKey: 'k' })
    expect(result.error).toContain('threw while being constructed')
    expect(result.adapter.readiness().ready).toBe(false)
  })

  it('rejects an object that does not implement the adapter interface', () => {
    const bogus = {
      packageName: 'pkg',
      module: { ...workingModule, createAdapter: () => ({ id: 'x' }) } as unknown as AdapterModule<unknown>,
    }
    const result = instantiateAdapter(bogus, { apiKey: 'k' })
    expect(result.error).toContain('does not implement SearchAdapter')
  })
})
