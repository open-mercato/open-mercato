/**
 * @jest-environment node
 *
 * Integration guard for #4526/#4693: compileAndImport must await its dynamic
 * import so that an import-time rejection settles inside the try block.
 * Returning the promise unawaited let the rejection escape the surrounding try,
 * which made the MikroORM v7 generated-cache recovery in the catch dead code for
 * exactly the failure it exists to repair. The one-line fix shipped in #4540;
 * this file is the end-to-end coverage for it.
 *
 * Two sibling suites cover this area and neither subsumes the other:
 *
 * - dynamicLoader.cacheRecovery.test.ts mocks ../generatedCacheRecovery in full
 *   and asserts how the loader *reacts* to a rejecting import (recovery is
 *   invoked once, the retry is capped at one, the error propagates when no
 *   recovery applies).
 * - generatedCacheRecovery.test.ts exercises the recovery module directly,
 *   without going through the loader.
 * - This file runs the REAL recovery module from the loader's catch, so the
 *   loader ↔ recovery seam is covered end to end: the on-disk marker, its
 *   `runtime-import-error` reason and the deleted-file list are asserted against
 *   what the production module actually writes. Nothing else in the repository
 *   reaches that reason.
 *
 * The fixture reproduces the window the catch exists for: a stale compiled file
 * that the startup scan (ensureMikroOrmV7GeneratedCacheCompatibility) cannot see
 * because it appears only once loading is already under way. The staged .mjs
 * therefore carries no decorator import at scan time — it writes a stale sibling
 * and then rejects with the error Node raises for a v6 decorator import, which
 * is what the import-time recovery is meant to repair.
 *
 * The assertions stop at the recovery boundary on purpose. Jest's module
 * registry keeps serving a file it has already evaluated, so the guarded retry
 * re-runs the rejecting module from memory no matter what recovery wrote to
 * disk — the outcome of the retry is a property of the test runner, not of the
 * loader. What #4526 broke, and what this guards, is that the catch runs at
 * all: before the fix the rejection escaped the try, so no import-time recovery
 * ever happened.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadBootstrapData } from '../dynamicLoader'

const STALE_SIBLING_BASENAME = 'stale-entity.generated.mjs'

/**
 * The decorator import is assembled at runtime rather than written literally:
 * a literal would make this fixture itself match the startup scan's staleness
 * pattern, so the scan would delete the cache before the import ever runs and
 * the import-time path under test would never be exercised.
 */
const REJECTING_COMPILED_SOURCE = [
  "const nodeFs = require('node:fs')",
  "const nodePath = require('node:path')",
  "const quote = String.fromCharCode(39)",
  "const staleImport = 'import { Entity, PrimaryKey } from ' + quote + '@mikro-orm/core' + quote",
  `nodeFs.writeFileSync(nodePath.join(__dirname, ${JSON.stringify(STALE_SIBLING_BASENAME)}), staleImport + '\\nexport const stale = true\\n')`,
  `throw new Error('The requested module ' + quote + '@mikro-orm/core' + quote + ' does not provide an export named ' + quote + 'Entity' + quote)`,
].join('\n')

/**
 * Jest resolves the loader's dynamic import through its own CommonJS registry,
 * so a staged .mjs has to be CommonJS to evaluate at all — esbuild's real ESM
 * output fails under the runner with "Unexpected token 'export'". The .ts
 * sources stay honest ESM: they are what the loader recompiles from once
 * recovery has deleted the cache.
 */
const GENERATED_MODULES: Record<string, { ts: string; compiled: string }> = {
  'entities.ids.generated': { ts: 'export const E = {}', compiled: 'module.exports = { E: {} }' },
  'modules.cli.generated': { ts: 'export const modules = []', compiled: 'module.exports = { modules: [] }' },
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
}

function contentHash(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Replace a compiled cache entry with staged content the runner can evaluate,
 * keeping the loader's own cache metadata authoritative.
 *
 * The loader validates a cache entry by hashing (#4724): it recompiles unless
 * the sibling `.cache.json` matches both the source and the compiled output.
 * Only `outputHash` is rewritten here — `version`, `inputHash` and
 * `dependencies` stay exactly as the loader wrote them, so the fixture models a
 * cache that is internally consistent and simply stale, and it cannot drift out
 * of step with the cache format the way a hand-built metadata file would.
 */
function stageCompiledCache(generatedDir: string, baseName: string, compiled: string) {
  const jsPath = path.join(generatedDir, `${baseName}.mjs`)
  const metadataPath = `${jsPath}.cache.json`

  fs.writeFileSync(jsPath, compiled)
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  metadata.outputHash = contentHash(fs.readFileSync(jsPath))
  fs.writeFileSync(metadataPath, JSON.stringify(metadata))
}

function hasCacheMetadata(generatedDir: string, baseName: string): boolean {
  return fs.existsSync(path.join(generatedDir, `${baseName}.mjs.cache.json`))
}

describe('compileAndImport — generated-cache recovery is reachable (#4526)', () => {
  let appRoot: string
  let generatedDir: string
  let warnSpy: jest.SpyInstance

  /**
   * Let the loader compile the generated sources so it writes real cache
   * metadata for each of them, replacing each compiled output with the
   * runner-evaluable staged content as it appears.
   *
   * The loader writes a module's metadata before importing it, so an import
   * failing here (esbuild's ESM output under Jest's CommonJS registry) is
   * expected and irrelevant — the metadata is the only thing this step is
   * after. That failure does abort the rest of the load, though, so one pass
   * only reaches the modules the loader got to: entities.ids first and alone,
   * then the remainder together. Repeating the pass lets each newly staged
   * module unblock the next batch, and the loop ends on the first pass that
   * loads cleanly, which is precisely when every module is staged.
   *
   * jest.resetModules() between passes is load-bearing. Jest keys its registry
   * on the resolved path and ignores the loader's `?cache=` query, so without
   * the reset a module would keep being served from its first (ESM, failing)
   * evaluation and no later pass could make progress.
   *
   * None of these failures carries a decorator-export error, so no recovery
   * runs and no marker is written during setup; both tests below would fail
   * loudly if one were.
   */
  async function primeAndStageCompiledCaches() {
    const baseNames = Object.keys(GENERATED_MODULES)
    for (let pass = 0; pass <= baseNames.length; pass += 1) {
      let loadedCleanly = true
      await loadBootstrapData(appRoot).catch(() => { loadedCleanly = false })
      jest.resetModules()
      if (loadedCleanly) return
      for (const baseName of baseNames) {
        if (!hasCacheMetadata(generatedDir, baseName)) continue
        stageCompiledCache(generatedDir, baseName, GENERATED_MODULES[baseName].compiled)
      }
    }
    throw new Error('[internal] loader never reached a fully staged generated cache')
  }

  beforeEach(async () => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-4526-'))
    generatedDir = path.join(appRoot, '.mercato', 'generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    fs.writeFileSync(
      path.join(appRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext' } }),
    )
    for (const [baseName, source] of Object.entries(GENERATED_MODULES)) {
      fs.writeFileSync(path.join(generatedDir, `${baseName}.ts`), source.ts)
    }
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await primeAndStageCompiledCaches()
  })

  afterEach(() => {
    warnSpy.mockRestore()
    fs.rmSync(appRoot, { recursive: true, force: true })
  })

  it('runs cache recovery when the compiled cache rejects on import', async () => {
    const rejectingPath = path.join(generatedDir, 'entities.ids.generated.mjs')
    stageCompiledCache(generatedDir, 'entities.ids.generated', REJECTING_COMPILED_SOURCE)

    await loadBootstrapData(appRoot).catch(() => undefined)

    const markerPath = path.join(generatedDir, '.mikro-orm-v7-cache-recovery.json')
    expect(fs.existsSync(markerPath)).toBe(true)

    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    expect(marker.reason).toBe('runtime-import-error')
    expect(marker.deletedFiles).toContain(rejectingPath)
    expect(marker.deletedFiles).toContain(path.join(generatedDir, STALE_SIBLING_BASENAME))

    expect(fs.readFileSync(rejectingPath, 'utf8')).not.toContain('does not provide an export named')
  })

  it('does not run recovery when the compiled cache imports cleanly', async () => {
    await loadBootstrapData(appRoot)

    expect(fs.existsSync(path.join(generatedDir, '.mikro-orm-v7-cache-recovery.json'))).toBe(false)
  })
})
