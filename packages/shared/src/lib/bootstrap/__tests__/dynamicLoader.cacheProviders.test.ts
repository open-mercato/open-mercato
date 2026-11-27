/**
 * @jest-environment node
 *
 * Worker, scheduler and CLI processes bootstrap through `bootstrapFromAppRoot`, so the app's
 * generated cache provider manifest must reach the provider selection state there too — the
 * Next.js runtime registers a lazy import from `bootstrap-common.ts`. Stock deployments
 * (no `CACHE_PROVIDER`) must never compile or import the manifest.
 *
 * Like the app-DI guard next to it, this test authors both the `.ts` sources and fresh compiled
 * `.mjs` siblings so compileAndImport takes its cache path and never invokes esbuild.
 */
jest.mock('../../logger', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: () => logger,
  }
  return { createLogger: () => logger }
})

jest.mock(
  '../factory.js',
  () => ({
    createBootstrap: () => () => {},
    waitForAsyncRegistration: async () => {},
  }),
  { virtual: true },
)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { resetCacheProviderSelectionForTests } from '@open-mercato/cache/provider'
import {
  getCacheProviderRegistrations,
  setCacheProviderRegistrations,
  type CacheProviderRegistration,
} from '../../cache/providers'
import { bootstrapFromAppRoot } from '../dynamicLoader'

type SourcePair = { ts: string; compiled: string }

const GENERATED_MODULES: Record<string, SourcePair> = {
  'entities.ids.generated': { ts: 'export const E = {}', compiled: 'module.exports = { E: {} }' },
  'modules.cli.generated': { ts: 'export const modules = []', compiled: 'module.exports = { modules: [] }' },
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
}

const MANIFEST_TS = 'export const cacheProviders = []'

const APP_TSCONFIG = JSON.stringify({
  compilerOptions: {
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    useDefineForClassFields: false,
    target: 'ES2022',
  },
})

function hash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function writeCompiledPair(appRoot: string, sourcePath: string, compiledPath: string, source: SourcePair) {
  fs.writeFileSync(sourcePath, source.ts)
  fs.writeFileSync(compiledPath, source.compiled)
  const sourceRelativePath = path.relative(appRoot, sourcePath).split(path.sep).join('/')
  fs.writeFileSync(`${compiledPath}.cache.json`, JSON.stringify({
    version: 5,
    inputHash: hash(JSON.stringify({
      version: 5,
      sourceHash: hash(source.ts),
      tsconfigHashes: { 'tsconfig.json': hash(APP_TSCONFIG) },
    })),
    outputHash: hash(source.compiled),
    dependencies: { [sourceRelativePath]: hash(source.ts) },
  }))
}

const createdAppRoots: string[] = []

function createAppRoot(manifest: SourcePair | null): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-cache-providers-'))
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), APP_TSCONFIG)
  for (const [baseName, source] of Object.entries(GENERATED_MODULES)) {
    writeCompiledPair(appRoot, path.join(generatedDir, `${baseName}.ts`), path.join(generatedDir, `${baseName}.mjs`), source)
  }
  if (manifest) {
    writeCompiledPair(
      appRoot,
      path.join(generatedDir, 'cache-providers.generated.ts'),
      path.join(generatedDir, 'cache-providers.compiled.mjs'),
      manifest,
    )
  }
  createdAppRoots.push(appRoot)
  return appRoot
}

const sentinel: CacheProviderRegistration = {
  id: 'sentinel/untouched',
  load: async () => { throw new Error('not loaded') },
  settings: () => ({}),
}

describe('bootstrapFromAppRoot — cache provider manifest reaches worker/CLI processes', () => {
  const originalProvider = process.env.CACHE_PROVIDER

  afterAll(() => {
    for (const root of createdAppRoots) fs.rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    resetCacheProviderSelectionForTests()
    setCacheProviderRegistrations([sentinel])
    delete process.env.CACHE_PROVIDER
  })

  afterEach(() => {
    resetCacheProviderSelectionForTests()
    if (originalProvider === undefined) delete process.env.CACHE_PROVIDER
    else process.env.CACHE_PROVIDER = originalProvider
  })

  it('does not touch the manifest when no provider is selected', async () => {
    const appRoot = createAppRoot({ ts: MANIFEST_TS, compiled: "throw new Error('manifest must not be imported')" })

    await bootstrapFromAppRoot(appRoot)

    expect(getCacheProviderRegistrations()).toEqual([sentinel])
  })

  it('registers the generated manifest when a provider is selected', async () => {
    process.env.CACHE_PROVIDER = 'acme/fake'
    const appRoot = createAppRoot({
      ts: MANIFEST_TS,
      compiled: "module.exports = { cacheProviders: [{ id: 'acme/fake', load: async () => null, settings: () => ({}) }] }",
    })

    await bootstrapFromAppRoot(appRoot)

    const registrations = getCacheProviderRegistrations()
    expect(registrations.map((registration) => registration.id)).toEqual(['acme/fake'])
  })

  it('registers an empty list when a provider is selected but the manifest was never generated', async () => {
    process.env.CACHE_PROVIDER = 'acme/fake'
    const appRoot = createAppRoot(null)

    await bootstrapFromAppRoot(appRoot)

    expect(getCacheProviderRegistrations()).toEqual([])
  })

  it('fails the bootstrap when the selected manifest does not export a cacheProviders array', async () => {
    process.env.CACHE_PROVIDER = 'acme/fake'
    const appRoot = createAppRoot({ ts: MANIFEST_TS, compiled: 'module.exports = {}' })

    await expect(bootstrapFromAppRoot(appRoot)).rejects.toThrow(/must export a cacheProviders array/)
  })

  it('fails the bootstrap when the selected manifest cannot be imported', async () => {
    process.env.CACHE_PROVIDER = 'acme/fake'
    const appRoot = createAppRoot({ ts: MANIFEST_TS, compiled: "throw new Error('src/providers/cache.ts is broken')" })

    await expect(bootstrapFromAppRoot(appRoot)).rejects.toMatchObject({
      name: 'CacheProviderError',
      code: 'load_failed',
      message: 'The cache provider manifest could not be loaded. Check src/providers/cache.ts.',
    })
  })
})
