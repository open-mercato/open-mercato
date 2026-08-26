/**
 * @jest-environment node
 *
 * Regression guard for #5582: the worker/CLI/scheduler bootstrap path (`bootstrapFromAppRoot`)
 * must dispatch `entry.overrides` declared in the app's own `src/modules.ts` the same way the
 * Next.js runtime does through `bootstrap-common.ts`'s `applyModuleOverridesFromEnabledModules`
 * call. Without it, the override side-registry stays empty for every CLI/worker process, so
 * `registerCliModules()` (called by `packages/cli/src/bin.ts` right after `bootstrapFromAppRoot`
 * returns) applies no overrides — `seed-encryption` then seeds the base `defaultEncryptionMaps`
 * instead of the app's `overrides.encryption.maps`.
 *
 * Like the #4327/#4491 guards next to it, this test authors both the `.ts` sources and fresh
 * compiled `.mjs` siblings so `compileAndImport` takes its cache path and never invokes esbuild.
 * The `.mjs` stubs use `module.exports` because Jest's CJS runtime handles the dynamic `import()`.
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
import { createLogger } from '../../logger'
import { bootstrapFromAppRoot } from '../dynamicLoader'
import { resetModuleContractOverridesForTests } from '../../../modules/overrides'
import { registerCliModules, getCliModules, getDefaultEncryptionMaps } from '../../../modules/registry'
import type { Module } from '../../../modules/registry'

const mockedLogger = createLogger('shared') as unknown as {
  debug: jest.Mock
  error: jest.Mock
}

const BASE_ENCRYPTION_MAP = { entityId: 'test_module.widget', fields: [{ field: 'email' }] }
const OVERRIDE_ENCRYPTION_MAP = {
  entityId: 'test_module.widget',
  fields: [{ field: 'email' }, { field: 'ssn' }],
}

const MODULES_CLI_GENERATED = {
  ts: `export const modules = [{ id: 'test_module', defaultEncryptionMaps: [${JSON.stringify(BASE_ENCRYPTION_MAP)}] }]`,
  compiled: `module.exports = { modules: [{ id: 'test_module', defaultEncryptionMaps: [${JSON.stringify(BASE_ENCRYPTION_MAP)}] }] }`,
}

const GENERATED_MODULES: Record<string, { ts: string; compiled: string }> = {
  'entities.ids.generated': { ts: 'export const E = {}', compiled: 'module.exports = { E: {} }' },
  'modules.cli.generated': MODULES_CLI_GENERATED,
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
}

const APP_TSCONFIG = JSON.stringify({
  compilerOptions: {
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    useDefineForClassFields: false,
    target: 'ES2022',
  },
})

const APP_MODULES_TS_WITH_OVERRIDE = [
  "export const enabledModules = [{",
  "  id: 'test_module',",
  '  overrides: {',
  '    encryption: {',
  `      maps: { 'test_module.widget': ${JSON.stringify(OVERRIDE_ENCRYPTION_MAP)} },`,
  '    },',
  '  },',
  '}]',
].join('\n')

const APP_MODULES_COMPILED_WITH_OVERRIDE = `module.exports = { enabledModules: [{ id: 'test_module', overrides: { encryption: { maps: { 'test_module.widget': ${JSON.stringify(OVERRIDE_ENCRYPTION_MAP)} } } } }] }`

const APP_MODULES_TS_WITHOUT_OVERRIDE = "export const enabledModules = [{ id: 'test_module' }]"
const APP_MODULES_COMPILED_WITHOUT_OVERRIDE = "module.exports = { enabledModules: [{ id: 'test_module' }] }"

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
      [sourceRelativePath]: hash(source.ts),
    },
  }))
}

const createdAppRoots: string[] = []

function createAppRoot(appModules: { ts: string; compiled: string } | null): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-app-modules-'))
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

  if (appModules) {
    fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true })
    writeCompiledPair(
      appRoot,
      path.join(appRoot, 'src', 'modules.ts'),
      path.join(generatedDir, 'app-modules-overrides.compiled.mjs'),
      appModules,
    )
  }

  createdAppRoots.push(appRoot)
  return appRoot
}

describe('bootstrapFromAppRoot — src/modules.ts entry.overrides reach CLI/worker processes', () => {
  afterAll(() => {
    for (const root of createdAppRoots) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    mockedLogger.debug.mockClear()
    mockedLogger.error.mockClear()
    resetModuleContractOverridesForTests()
  })

  afterEach(() => {
    resetModuleContractOverridesForTests()
  })

  it('dispatches overrides.encryption.maps so getDefaultEncryptionMaps reflects it after registerCliModules', async () => {
    const appRoot = createAppRoot({ ts: APP_MODULES_TS_WITH_OVERRIDE, compiled: APP_MODULES_COMPILED_WITH_OVERRIDE })

    const data = await bootstrapFromAppRoot(appRoot)
    registerCliModules(data.modules as Module[])

    const maps = getDefaultEncryptionMaps(getCliModules())
    const widgetMap = maps.find((entry) => entry.entityId === 'test_module.widget')

    expect(widgetMap).toBeDefined()
    expect(widgetMap?.fields.map((field) => field.field)).toEqual(['email', 'ssn'])
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('keeps the base defaultEncryptionMaps when src/modules.ts declares no overrides', async () => {
    const appRoot = createAppRoot({
      ts: APP_MODULES_TS_WITHOUT_OVERRIDE,
      compiled: APP_MODULES_COMPILED_WITHOUT_OVERRIDE,
    })

    const data = await bootstrapFromAppRoot(appRoot)
    registerCliModules(data.modules as Module[])

    const maps = getDefaultEncryptionMaps(getCliModules())
    const widgetMap = maps.find((entry) => entry.entityId === 'test_module.widget')

    expect(widgetMap).toBeDefined()
    expect(widgetMap?.fields.map((field) => field.field)).toEqual(['email'])
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('reports an error and keeps bootstrapping when src/modules.ts fails to load', async () => {
    const appRoot = createAppRoot({
      ts: APP_MODULES_TS_WITH_OVERRIDE,
      compiled: "throw new Error('src/modules.ts is broken')",
    })

    const data = await bootstrapFromAppRoot(appRoot)
    registerCliModules(data.modules as Module[])

    const maps = getDefaultEncryptionMaps(getCliModules())
    const widgetMap = maps.find((entry) => entry.entityId === 'test_module.widget')

    expect(widgetMap?.fields.map((field) => field.field)).toEqual(['email'])
    expect(mockedLogger.error).toHaveBeenCalledTimes(1)
    const [message, fields] = mockedLogger.error.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toContain('Failed to load the app-level modules file')
    expect((fields.err as Error).message).toContain('src/modules.ts is broken')
  })
})
