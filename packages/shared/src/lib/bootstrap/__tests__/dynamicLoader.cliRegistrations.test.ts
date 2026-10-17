/**
 * @jest-environment node
 *
 * The CLI/queue-worker bootstrap path (loadBootstrapData) never loads
 * bootstrap-registrations.generated.ts, so generator-plugin registrations that
 * workers and CLI commands need are emitted into the optional
 * bootstrap-registrations.cli.generated.ts and exposed as
 * `cliBootstrapRegistrations`. These tests pin that the function reaches
 * BootstrapData, that an absent file is a silent no-op, and that a file that
 * exists but fails to import is reported rather than swallowed.
 *
 * Like dynamicLoader.commandInterceptors.test.ts, each generated .ts source gets a
 * fresh compiled .mjs sibling plus cache manifest so compileAndImport takes its
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
import { loadBootstrapData } from '../dynamicLoader'

const mockedLogger = createLogger('shared') as unknown as {
  debug: jest.Mock
  error: jest.Mock
}

const CLI_REGISTRATIONS = 'bootstrap-registrations.cli.generated'
const CALL_COUNTER = '__omCliBootstrapRegistrationCalls'

type GeneratedSource = { ts: string; compiled: string }

const GENERATED_MODULES: Record<string, GeneratedSource> = {
  'entities.ids.generated': { ts: 'export const E = {}', compiled: 'module.exports = { E: {} }' },
  'modules.cli.generated': { ts: 'export const modules = []', compiled: 'module.exports = { modules: [] }' },
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
  [CLI_REGISTRATIONS]: {
    ts: 'export function runCliBootstrapRegistrations(): void {}',
    compiled: `module.exports = {
      runCliBootstrapRegistrations: function runCliBootstrapRegistrations() {
        globalThis.${CALL_COUNTER} = (globalThis.${CALL_COUNTER} || 0) + 1
      },
    }`,
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

function hash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function writeGeneratedModule(generatedDir: string, baseName: string, source: GeneratedSource): void {
  const sourcePath = path.join(generatedDir, `${baseName}.ts`)
  const compiledPath = path.join(generatedDir, `${baseName}.mjs`)
  const sourceRelativePath = path.relative(
    path.dirname(path.dirname(generatedDir)),
    sourcePath,
  ).split(path.sep).join('/')
  fs.writeFileSync(sourcePath, source.ts)
  fs.writeFileSync(compiledPath, source.compiled)
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

function createAppRoot(overrides: Record<string, GeneratedSource | null> = {}): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-cli-registrations-'))
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), APP_TSCONFIG)
  for (const [baseName, source] of Object.entries({ ...GENERATED_MODULES, ...overrides })) {
    if (source) writeGeneratedModule(generatedDir, baseName, source)
  }
  createdAppRoots.push(appRoot)
  return appRoot
}

function readCallCount(): number {
  const value = (globalThis as Record<string, unknown>)[CALL_COUNTER]
  return typeof value === 'number' ? value : 0
}

describe('loadBootstrapData — generator-plugin registrations reach worker/CLI bootstrap', () => {
  afterAll(() => {
    for (const root of createdAppRoots) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    mockedLogger.debug.mockClear()
    mockedLogger.error.mockClear()
    delete (globalThis as Record<string, unknown>)[CALL_COUNTER]
  })

  it('exposes runCliBootstrapRegistrations as cliBootstrapRegistrations without running it', async () => {
    const data = await loadBootstrapData(createAppRoot())

    expect(typeof data.cliBootstrapRegistrations).toBe('function')
    expect(readCallCount()).toBe(0)

    data.cliBootstrapRegistrations?.()

    expect(readCallCount()).toBe(1)
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('leaves cliBootstrapRegistrations undefined, without logging an error, when the file is absent', async () => {
    const data = await loadBootstrapData(createAppRoot({ [CLI_REGISTRATIONS]: null }))

    expect(data.cliBootstrapRegistrations).toBeUndefined()
    expect(mockedLogger.error).not.toHaveBeenCalled()
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      'Optional generated registry not present, using empty fallback',
      { file: `${CLI_REGISTRATIONS}.ts` },
    )
  })

  it('leaves cliBootstrapRegistrations undefined when the file does not export a function', async () => {
    const data = await loadBootstrapData(createAppRoot({
      [CLI_REGISTRATIONS]: {
        ts: 'export const runCliBootstrapRegistrations = 42',
        compiled: 'module.exports = { runCliBootstrapRegistrations: 42 }',
      },
    }))

    expect(data.cliBootstrapRegistrations).toBeUndefined()
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('logs an error and leaves cliBootstrapRegistrations undefined when the file fails to import', async () => {
    const data = await loadBootstrapData(createAppRoot({
      [CLI_REGISTRATIONS]: {
        ts: 'export function runCliBootstrapRegistrations(): void {}',
        compiled: `throw new Error('${CLI_REGISTRATIONS} is broken')`,
      },
    }))

    expect(data.cliBootstrapRegistrations).toBeUndefined()
    expect(mockedLogger.error).toHaveBeenCalledTimes(1)
    const [message, fields] = mockedLogger.error.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toContain('Failed to load generated registry')
    expect(fields.file).toBe(`${CLI_REGISTRATIONS}.ts`)
    expect((fields.err as Error).message).toContain(`${CLI_REGISTRATIONS} is broken`)
  })
})
