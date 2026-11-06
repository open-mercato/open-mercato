/**
 * @jest-environment node
 *
 * Regression guard: the worker/CLI/scheduler bootstrap path (bootstrapFromAppRoot) must register
 * the app-level DI hook (`src/di.ts`) the same way the Next.js runtime does through its own
 * `src/bootstrap.ts`. Without it, `getAppDiRegistrar()` stays null in those processes, so the app's
 * registrations silently never run there and every request container falls back to a doomed
 * `import('@/di')` — the `@/` alias does not exist in a plain Node ESM process, so it throws
 * ERR_MODULE_NOT_FOUND once per created container (once per queued job).
 *
 * Like the #4327 guard next to it, this test authors both the `.ts` sources and fresh compiled
 * `.mjs` siblings so compileAndImport takes its cache path and never invokes esbuild. The `.mjs`
 * stubs use module.exports because Jest's CJS runtime handles the dynamic import().
 *
 * `bootstrapFromAppRoot` reaches the factory through `import('./factory.js')`, a specifier with no
 * on-disk counterpart under Jest's CJS resolver, so it is mocked virtually.
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

const reportErrorMock = jest.fn()

jest.mock('../../telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

const createBootstrapMock = jest.fn(() => () => {})

jest.mock(
  '../factory.js',
  () => ({
    createBootstrap: (...args: unknown[]) => createBootstrapMock(...(args as [])),
    waitForAsyncRegistration: async () => {},
  }),
  { virtual: true },
)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createLogger } from '../../logger'
import { BOOTSTRAP_REGISTRATIONS_FAILED_KEY, didBootstrapRegistrationsFail } from '../bootstrapRegistrations'
import { bootstrapFromAppRoot } from '../dynamicLoader'

const mockedLogger = createLogger('shared') as unknown as {
  debug: jest.Mock
  error: jest.Mock
}

const APP_DI_CALL_COUNTER_KEY = '__omTestAppDiRegisterCalls__'
const BOOTSTRAP_REGISTRATION_CALL_COUNTER_KEY = '__omTestBootstrapRegistrationCalls__'

const GENERATED_MODULES: Record<string, { ts: string; compiled: string }> = {
  'entities.ids.generated': { ts: 'export const E = {}', compiled: 'module.exports = { E: {} }' },
  'modules.cli.generated': { ts: 'export const modules = []', compiled: 'module.exports = { modules: [] }' },
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
  'bootstrap-registrations.generated': {
    ts: 'export function runBootstrapRegistrations() {}',
    compiled: [
      'module.exports = {',
      '  runBootstrapRegistrations: () => {',
      `    globalThis['${BOOTSTRAP_REGISTRATION_CALL_COUNTER_KEY}'] = (globalThis['${BOOTSTRAP_REGISTRATION_CALL_COUNTER_KEY}'] ?? 0) + 1`,
      '  },',
      '}',
    ].join('\n'),
  },
}

const APP_TSCONFIG = JSON.stringify({
  compilerOptions: {
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    useDefineForClassFields: false,
    target: 'ES2022',
  },
})

const APP_DI_TS = 'export function register() {}'

const APP_DI_COMPILED = [
  'module.exports = {',
  '  register: () => {',
  `    globalThis['${APP_DI_CALL_COUNTER_KEY}'] = (globalThis['${APP_DI_CALL_COUNTER_KEY}'] ?? 0) + 1`,
  '  },',
  '}',
].join('\n')

function hash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function writeCompiledPair(
  appRoot: string,
  sourcePath: string,
  compiledPath: string,
  source: { ts: string; compiled: string },
) {
  fs.writeFileSync(sourcePath, source.ts)
  fs.writeFileSync(compiledPath, source.compiled)
  const sourceRelativePath = path.relative(appRoot, sourcePath).split(path.sep).join('/')
  fs.writeFileSync(`${compiledPath}.cache.json`, JSON.stringify({
    version: 5,
    inputHash: hash(JSON.stringify({
      version: 5,
      sourceHash: hash(source.ts),
      tsconfigHashes: {
        'tsconfig.json': hash(APP_TSCONFIG),
      },
    })),
    outputHash: hash(source.compiled),
    dependencies: {
      [sourceRelativePath]: hash(source.ts),
    },
  }))
}

const createdAppRoots: string[] = []

function createAppRoot(appDi: { ts: string; compiled: string } | null): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-app-di-'))
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), APP_TSCONFIG)

  for (const [baseName, source] of Object.entries(GENERATED_MODULES)) {
    writeCompiledPair(
      appRoot,
      path.join(generatedDir, `${baseName}.ts`),
      path.join(generatedDir, `${baseName}.mjs`),
      source,
    )
  }

  if (appDi) {
    fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true })
    writeCompiledPair(
      appRoot,
      path.join(appRoot, 'src', 'di.ts'),
      path.join(generatedDir, 'app-di.compiled.mjs'),
      appDi,
    )
  }

  createdAppRoots.push(appRoot)
  return appRoot
}

function appDiRegistrarArgument(): unknown {
  const [, options] = createBootstrapMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
  return options?.appDiRegistrar
}

describe('bootstrapFromAppRoot — app-level DI reaches worker/CLI processes', () => {
  afterAll(() => {
    for (const root of createdAppRoots) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    createBootstrapMock.mockClear()
    mockedLogger.debug.mockClear()
    mockedLogger.error.mockClear()
    delete (globalThis as Record<string, unknown>)[APP_DI_CALL_COUNTER_KEY]
    delete (globalThis as Record<string, unknown>)[BOOTSTRAP_REGISTRATION_CALL_COUNTER_KEY]
    delete (globalThis as Record<string, unknown>)[BOOTSTRAP_REGISTRATIONS_FAILED_KEY]
    reportErrorMock.mockClear()
  })

  it('flags and reports the failure when the generated registrations cannot load', async () => {
    const appRoot = createAppRoot(null)
    const generatedDir = path.join(appRoot, '.mercato', 'generated')
    writeCompiledPair(
      appRoot,
      path.join(generatedDir, 'bootstrap-registrations.generated.ts'),
      path.join(generatedDir, 'bootstrap-registrations.generated.mjs'),
      { ts: 'export function runBootstrapRegistrations() {}', compiled: "throw new Error('broken module')" },
    )

    await expect(bootstrapFromAppRoot(appRoot)).resolves.toBeDefined()

    expect(didBootstrapRegistrationsFail()).toBe(true)
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'shared.bootstrap_registrations_load_failed' }),
    )
  })

  it('does not flag a failure when the file has not been generated', async () => {
    const appRoot = createAppRoot(null)
    fs.rmSync(path.join(appRoot, '.mercato', 'generated', 'bootstrap-registrations.generated.ts'))

    await bootstrapFromAppRoot(appRoot)

    expect(didBootstrapRegistrationsFail()).toBe(false)
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('runs generated registrations for worker and CLI processes (#7980)', async () => {
    const appRoot = createAppRoot(null)

    await bootstrapFromAppRoot(appRoot)

    expect((globalThis as Record<string, unknown>)[BOOTSTRAP_REGISTRATION_CALL_COUNTER_KEY]).toBe(1)
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('passes the app DI register() from src/di.ts to createBootstrap', async () => {
    const appRoot = createAppRoot({ ts: APP_DI_TS, compiled: APP_DI_COMPILED })

    await bootstrapFromAppRoot(appRoot)

    const registrar = appDiRegistrarArgument()
    expect(typeof registrar).toBe('function')

    await (registrar as (container: unknown) => unknown)({})
    expect((globalThis as Record<string, unknown>)[APP_DI_CALL_COUNTER_KEY]).toBe(1)
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('bootstraps without an app DI registrar when src/di.ts is absent', async () => {
    const appRoot = createAppRoot(null)

    await bootstrapFromAppRoot(appRoot)

    expect(createBootstrapMock).toHaveBeenCalledTimes(1)
    expect(appDiRegistrarArgument()).toBeUndefined()
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('reports an error and keeps bootstrapping when src/di.ts fails to load', async () => {
    const appRoot = createAppRoot({
      ts: APP_DI_TS,
      compiled: "throw new Error('src/di.ts is broken')",
    })

    await bootstrapFromAppRoot(appRoot)

    expect(createBootstrapMock).toHaveBeenCalledTimes(1)
    expect(appDiRegistrarArgument()).toBeUndefined()
    expect(mockedLogger.error).toHaveBeenCalledTimes(1)
    const [message, fields] = mockedLogger.error.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toContain('Failed to load the app-level DI module')
    expect((fields.err as Error).message).toContain('src/di.ts is broken')
  })

  it('reports an error and keeps bootstrapping when src/di.ts exports no register()', async () => {
    const appRoot = createAppRoot({
      ts: APP_DI_TS,
      compiled: 'module.exports = {}',
    })

    await bootstrapFromAppRoot(appRoot)

    expect(createBootstrapMock).toHaveBeenCalledTimes(1)
    expect(appDiRegistrarArgument()).toBeUndefined()
    expect(mockedLogger.error).toHaveBeenCalledTimes(1)
    expect(mockedLogger.error.mock.calls[0][0]).toContain('exports no register()')
  })
})
