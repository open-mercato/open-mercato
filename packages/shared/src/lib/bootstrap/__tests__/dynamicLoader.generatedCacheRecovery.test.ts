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

const GENERATED_MODULES: Record<string, { ts: string; compiled: string }> = {
  'entities.ids.generated': { ts: 'export const E = {}', compiled: 'module.exports = { E: {} }' },
  'modules.cli.generated': { ts: 'export const modules = []', compiled: 'module.exports = { modules: [] }' },
  'entities.generated': { ts: 'export const entities = []', compiled: 'module.exports = { entities: [] }' },
  'di.generated': { ts: 'export const diRegistrars = []', compiled: 'module.exports = { diRegistrars: [] }' },
}

function writeGeneratedModule(generatedDir: string, baseName: string, source: { ts: string; compiled: string }) {
  fs.writeFileSync(path.join(generatedDir, `${baseName}.ts`), source.ts)
  fs.writeFileSync(path.join(generatedDir, `${baseName}.mjs`), source.compiled)
  const fresh = new Date(Date.now() + 60_000)
  fs.utimesSync(path.join(generatedDir, `${baseName}.mjs`), fresh, fresh)
}

describe('compileAndImport — generated-cache recovery is reachable (#4526)', () => {
  let appRoot: string
  let generatedDir: string
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-4526-'))
    generatedDir = path.join(appRoot, '.mercato', 'generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    for (const [baseName, source] of Object.entries(GENERATED_MODULES)) {
      writeGeneratedModule(generatedDir, baseName, source)
    }
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    fs.rmSync(appRoot, { recursive: true, force: true })
  })

  it('runs cache recovery when the compiled cache rejects on import', async () => {
    const rejectingPath = path.join(generatedDir, 'entities.ids.generated.mjs')
    writeGeneratedModule(generatedDir, 'entities.ids.generated', {
      ts: 'export const E = { recovered: true }',
      compiled: REJECTING_COMPILED_SOURCE,
    })

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
