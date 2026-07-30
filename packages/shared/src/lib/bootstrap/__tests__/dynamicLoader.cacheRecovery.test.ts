/**
 * @jest-environment node
 *
 * Regression guard for #4526: compileAndImport must await its dynamic import so
 * an import-time rejection is caught by the surrounding try/catch and reaches
 * the MikroORM v7 generated-cache recovery. Returning the promise unawaited let
 * it settle after the try block had exited, so the reactive recovery was dead
 * code for exactly the failure it exists to repair (a stale generated cache
 * whose top-level `@mikro-orm/core` decorator import no longer resolves).
 *
 * generatedCacheRecovery is mocked here: it owns cache detection/deletion and is
 * covered by its own tests, while these cases only assert how dynamicLoader
 * reacts to a rejecting import. The recovery double rewrites the compiled
 * sibling the way a real cache wipe plus recompile would, so the retry loads the
 * refreshed module without invoking esbuild.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadBootstrapData } from '../dynamicLoader'
import {
  ensureMikroOrmV7GeneratedCacheCompatibility,
  recoverMikroOrmV7GeneratedCacheFromImportError,
  type GeneratedCacheRecoveryResult,
} from '../generatedCacheRecovery'

jest.mock('../generatedCacheRecovery', () => ({
  ensureMikroOrmV7GeneratedCacheCompatibility: jest.fn(),
  recoverMikroOrmV7GeneratedCacheFromImportError: jest.fn(),
}))

const ensureCompatibilityMock = ensureMikroOrmV7GeneratedCacheCompatibility as jest.MockedFunction<
  typeof ensureMikroOrmV7GeneratedCacheCompatibility
>
const recoverFromImportErrorMock = recoverMikroOrmV7GeneratedCacheFromImportError as jest.MockedFunction<
  typeof recoverMikroOrmV7GeneratedCacheFromImportError
>

const NO_RECOVERY: GeneratedCacheRecoveryResult = { applied: false, deletedFiles: [], markerPath: null }
const STALE_DECORATOR_IMPORT_ERROR =
  "The requested module '@mikro-orm/core' does not provide an export named 'Entity'"

const STALE_ENTITY_IDS_CACHE = `throw new SyntaxError(${JSON.stringify(STALE_DECORATOR_IMPORT_ERROR)})`
const FRESH_ENTITY_IDS_CACHE = "module.exports = { E: { example: { todo: 'example:todo' } } }"

const BASE_GENERATED_MODULES: Record<string, { ts: string; compiled: string }> = {
  'modules.cli.generated': { ts: 'export const modules = []', compiled: 'module.exports = { modules: [] }' },
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
}

let compiledCacheGeneration = 0
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

function writeGeneratedModule(generatedDir: string, baseName: string, source: { ts: string; compiled: string }) {
  fs.writeFileSync(path.join(generatedDir, `${baseName}.ts`), source.ts)
  writeCompiledSibling(generatedDir, baseName, source.compiled)
}

/**
 * Write the .mjs sibling with an mtime ahead of its .ts source so
 * compileAndImport takes its cache path and never invokes esbuild. Each write
 * advances the timestamp, which also gives the retry a distinct `?mtime=` import
 * URL instead of the rejected module's cached one.
 */
function writeCompiledSibling(generatedDir: string, baseName: string, compiled: string) {
  const source = fs.readFileSync(path.join(generatedDir, `${baseName}.ts`), 'utf8')
  const inputHash = hash(JSON.stringify({
    version: 3,
    sourceHash: hash(source),
    tsconfigHash: hash(APP_TSCONFIG),
  }))
  const sourceRelativePath = path.relative(
    path.dirname(path.dirname(generatedDir)),
    path.join(generatedDir, `${baseName}.ts`),
  ).split(path.sep).join('/')
  const compiledPath = path.join(generatedDir, `${baseName}.mjs`)
  fs.writeFileSync(compiledPath, compiled)
  fs.writeFileSync(`${compiledPath}.cache.json`, JSON.stringify({
    version: 3,
    inputHash,
    outputHash: hash(compiled),
    dependencies: {
      [sourceRelativePath]: hash(source),
    },
  }))
  compiledCacheGeneration += 1
  const fresh = new Date(Date.now() + compiledCacheGeneration * 60_000)
  fs.utimesSync(compiledPath, fresh, fresh)
}

function createAppRoot(entityIdsCache: string): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-4526-'))
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.writeFileSync(path.join(appRoot, 'tsconfig.json'), APP_TSCONFIG)
  for (const [baseName, source] of Object.entries(BASE_GENERATED_MODULES)) {
    writeGeneratedModule(generatedDir, baseName, source)
  }
  writeGeneratedModule(generatedDir, 'entities.ids.generated', {
    ts: 'export const E = {}',
    compiled: entityIdsCache,
  })
  return appRoot
}

function recoverByRewritingCache(appRoot: string, compiled: string): GeneratedCacheRecoveryResult {
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  writeCompiledSibling(generatedDir, 'entities.ids.generated', compiled)
  // Node busts its ESM cache through the `?mtime=` query compileAndImport
  // appends; Jest's registry keys on the resolved path alone, so the retry would
  // otherwise replay the rejected evaluation instead of the rewritten file.
  jest.resetModules()
  return {
    applied: true,
    deletedFiles: [path.join(generatedDir, 'entities.ids.generated.mjs')],
    markerPath: path.join(generatedDir, '.mikro-orm-v7-cache-recovery.json'),
  }
}

describe('compileAndImport — a rejecting import reaches the cache recovery (#4526)', () => {
  const appRoots: string[] = []

  beforeEach(() => {
    ensureCompatibilityMock.mockReset()
    recoverFromImportErrorMock.mockReset()
    ensureCompatibilityMock.mockReturnValue(NO_RECOVERY)
    recoverFromImportErrorMock.mockReturnValue(NO_RECOVERY)
  })

  afterAll(() => {
    for (const appRoot of appRoots) {
      fs.rmSync(appRoot, { recursive: true, force: true })
    }
  })

  function createTrackedAppRoot(entityIdsCache: string): string {
    const appRoot = createAppRoot(entityIdsCache)
    appRoots.push(appRoot)
    return appRoot
  }

  it('recovers the stale cache and loads the refreshed module', async () => {
    const appRoot = createTrackedAppRoot(STALE_ENTITY_IDS_CACHE)
    recoverFromImportErrorMock.mockImplementation(() => recoverByRewritingCache(appRoot, FRESH_ENTITY_IDS_CACHE))

    const data = await loadBootstrapData(appRoot)

    expect(data.entityIds).toEqual({ example: { todo: 'example:todo' } })
    expect(recoverFromImportErrorMock).toHaveBeenCalledTimes(1)
    const [recoveryAppRoot, recoveryError] = recoverFromImportErrorMock.mock.calls[0]
    expect(recoveryAppRoot).toBe(appRoot)
    expect(String((recoveryError as Error).message)).toContain(STALE_DECORATOR_IMPORT_ERROR)
  })

  it('propagates the import error when no recovery applies', async () => {
    const appRoot = createTrackedAppRoot(STALE_ENTITY_IDS_CACHE)

    await expect(loadBootstrapData(appRoot)).rejects.toThrow(STALE_DECORATOR_IMPORT_ERROR)
    expect(recoverFromImportErrorMock).toHaveBeenCalledTimes(1)
  })

  it('retries at most once when the refreshed cache still fails to import', async () => {
    const appRoot = createTrackedAppRoot(STALE_ENTITY_IDS_CACHE)
    recoverFromImportErrorMock.mockImplementation(() => recoverByRewritingCache(appRoot, STALE_ENTITY_IDS_CACHE))

    await expect(loadBootstrapData(appRoot)).rejects.toThrow(STALE_DECORATOR_IMPORT_ERROR)
    expect(recoverFromImportErrorMock).toHaveBeenCalledTimes(1)
  })
})
