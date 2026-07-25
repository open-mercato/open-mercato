/**
 * @jest-environment node
 *
 * Regression guard for #4327: the CLI/queue-worker bootstrap path
 * (loadBootstrapData) must load command-interceptors.generated.ts and expose
 * `commandInterceptorEntries` in its BootstrapData. The interceptor registry is
 * per-process, so a worker that omits the field silently no-ops every command
 * interceptor while the Next.js runtime applies them — split behavior between
 * web and queued execution of the same command.
 *
 * The test authors both the generated .ts sources and fresh compiled .mjs
 * siblings, so compileAndImport takes its cache path and never invokes esbuild.
 * The .mjs stubs use module.exports because Jest's CJS runtime handles the
 * dynamic import() and does not transform .mjs files; the loader consumes the
 * named exports identically either way.
 *
 * The third case guards #4491: the compatibility fallback to an empty list must
 * stay silent for an absent registry, but must report a registry that exists and
 * fails to load — otherwise the #4327 condition can recur with no diagnostics.
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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '../../logger'
import { loadBootstrapData } from '../dynamicLoader'

const mockedLogger = createLogger('shared') as unknown as {
  debug: jest.Mock
  error: jest.Mock
}

const GENERATED_MODULES: Record<string, { ts: string; compiled: string }> = {
  'entities.ids.generated': { ts: 'export const E = {}', compiled: 'module.exports = { E: {} }' },
  'modules.cli.generated': { ts: 'export const modules = []', compiled: 'module.exports = { modules: [] }' },
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
  'command-interceptors.generated': {
    ts: 'export const commandInterceptorEntries = []',
    compiled: `module.exports = { commandInterceptorEntries: [
      { moduleId: 'example', interceptors: [{ id: 'example.adjust-probability' }] },
    ] }`,
  },
}

function writeGeneratedModule(generatedDir: string, baseName: string, source: { ts: string; compiled: string }) {
  fs.writeFileSync(path.join(generatedDir, `${baseName}.ts`), source.ts)
  fs.writeFileSync(path.join(generatedDir, `${baseName}.mjs`), source.compiled)
  const fresh = new Date(Date.now() + 60_000)
  fs.utimesSync(path.join(generatedDir, `${baseName}.mjs`), fresh, fresh)
}

const createdAppRoots: string[] = []

function createAppRoot(overrides: Record<string, { ts: string; compiled: string }> = {}): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-4327-'))
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  for (const [baseName, source] of Object.entries({ ...GENERATED_MODULES, ...overrides })) {
    writeGeneratedModule(generatedDir, baseName, source)
  }
  createdAppRoots.push(appRoot)
  return appRoot
}

describe('loadBootstrapData — command interceptors reach worker/CLI bootstrap (#4327)', () => {
  let appRoot: string

  beforeAll(() => {
    appRoot = createAppRoot()
  })

  afterAll(() => {
    for (const root of createdAppRoots) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    mockedLogger.debug.mockClear()
    mockedLogger.error.mockClear()
  })

  it('returns commandInterceptorEntries from command-interceptors.generated', async () => {
    const data = await loadBootstrapData(appRoot)

    expect(data.commandInterceptorEntries).toEqual([
      { moduleId: 'example', interceptors: [{ id: 'example.adjust-probability' }] },
    ])
  })

  it('falls back to an empty array (not undefined) when the generated file is absent', async () => {
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    fs.rmSync(path.join(generatedDir, 'command-interceptors.generated.ts'))
    fs.rmSync(path.join(generatedDir, 'command-interceptors.generated.mjs'))

    const data = await loadBootstrapData(appRoot)

    expect(data.commandInterceptorEntries).toEqual([])
    expect(data.commandLoaderEntries).toEqual([])
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('logs an error when the generated file exists but fails to import (#4491)', async () => {
    const brokenAppRoot = createAppRoot({
      'command-interceptors.generated': {
        ts: 'export const commandInterceptorEntries = []',
        compiled: "throw new Error('command-interceptors.generated is broken')",
      },
    })

    const data = await loadBootstrapData(brokenAppRoot)

    expect(data.commandInterceptorEntries).toEqual([])
    expect(mockedLogger.error).toHaveBeenCalledTimes(1)
    const [message, fields] = mockedLogger.error.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toContain('Failed to load generated registry')
    expect(fields.file).toBe('command-interceptors.generated.ts')
    expect((fields.err as Error).message).toContain('command-interceptors.generated is broken')
  })
})
