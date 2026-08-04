/**
 * @jest-environment node
 *
 * The app-level DI override module (`<appDir>/src/di.ts`, imported as `@/di`
 * from bundled app code) must reach unbundled runtimes too. Next.js resolves
 * `@/` through its bundler, so the request container's `import('@/di')` fallback
 * only works in the web process — in CLI and queue-worker processes it throws
 * ERR_MODULE_NOT_FOUND, which meant app DI registrations silently never applied
 * there while Node's stack was dumped on every container creation.
 *
 * As in the sibling loader suites, the test authors both the .ts source and a
 * fresh compiled .mjs with its cache sidecar, so compileAndImport takes its
 * cache path and never invokes esbuild.
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
import crypto from 'node:crypto'
import { createLogger } from '../../logger'
import { loadAppDiRegistrar } from '../dynamicLoader'

const mockedLogger = createLogger('shared') as unknown as {
  warn: jest.Mock
  error: jest.Mock
}

const APP_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
  },
})

function hash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

const createdAppRoots: string[] = []

function createAppRoot(source: { ts: string; compiled: string } | null): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-app-di-'))
  fs.mkdirSync(path.join(appRoot, '.mercato'), { recursive: true })
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), APP_TSCONFIG)
  createdAppRoots.push(appRoot)

  if (!source) return appRoot

  const sourcePath = path.join(appRoot, 'src', 'di.ts')
  const compiledPath = path.join(appRoot, '.mercato', 'app-di.mjs')
  fs.writeFileSync(sourcePath, source.ts)
  fs.writeFileSync(compiledPath, source.compiled)
  fs.writeFileSync(`${compiledPath}.cache.json`, JSON.stringify({
    version: 4,
    inputHash: hash(JSON.stringify({
      version: 4,
      sourceHash: hash(source.ts),
      tsconfigHashes: {
        'tsconfig.json': hash(APP_TSCONFIG),
      },
    })),
    outputHash: hash(source.compiled),
    dependencies: {
      'src/di.ts': hash(source.ts),
    },
  }))
  return appRoot
}

describe('loadAppDiRegistrar — app DI overrides reach worker/CLI bootstrap', () => {
  afterAll(() => {
    for (const root of createdAppRoots) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    mockedLogger.warn.mockClear()
    mockedLogger.error.mockClear()
  })

  it('returns the register() export of src/di.ts', async () => {
    const appRoot = createAppRoot({
      ts: 'export function register() {}',
      compiled: `module.exports = { register: (container) => { container.registered = true } }`,
    })

    const registrar = await loadAppDiRegistrar(appRoot)

    expect(typeof registrar).toBe('function')
    const container = {} as Record<string, unknown>
    await registrar?.(container as never)
    expect(container.registered).toBe(true)
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('resolves to null quietly when the app ships no src/di.ts', async () => {
    const appRoot = createAppRoot(null)

    expect(await loadAppDiRegistrar(appRoot)).toBeNull()
    expect(mockedLogger.warn).not.toHaveBeenCalled()
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('warns and skips when src/di.ts exports no register()', async () => {
    const appRoot = createAppRoot({
      ts: 'export const unrelated = 1',
      compiled: 'module.exports = { unrelated: 1 }',
    })

    expect(await loadAppDiRegistrar(appRoot)).toBeNull()
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1)
  })

  it('reports an error and skips when src/di.ts fails to import', async () => {
    const appRoot = createAppRoot({
      ts: 'export function register() {}',
      compiled: "throw new Error('app di module is broken')",
    })

    expect(await loadAppDiRegistrar(appRoot)).toBeNull()
    expect(mockedLogger.error).toHaveBeenCalledTimes(1)
    const [message, fields] = mockedLogger.error.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toContain('Failed to load app-level DI module')
    expect((fields.err as Error).message).toContain('app di module is broken')
  })
})
