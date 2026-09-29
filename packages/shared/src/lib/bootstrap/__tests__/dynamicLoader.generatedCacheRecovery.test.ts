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
 * Every loadBootstrapData call runs in a child process (#4960). Driving the real
 * loader in-process made this suite flaky at ~30-50%: a load that aborts part way
 * leaves the sibling compileAndImport calls of its Promise.all still running, and
 * those in-flight esbuild builds rewrite the very .mjs files the fixture stages
 * between passes, so priming was a race rather than a loop. A child process also
 * gives each load a real Node module registry, so esbuild's ESM output imports
 * natively and the fixture no longer has to stage CommonJS stand-ins for it.
 *
 * Because the child is a real Node process, the guarded retry now completes for
 * real: recovery deletes the stale cache, the loader recompiles from the .ts
 * sources and the load succeeds. That end state is asserted too — under the old
 * in-process fixture it was unreachable, because the runner kept serving the
 * rejecting module from memory no matter what recovery wrote to disk.
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const STALE_SIBLING_BASENAME = 'stale-entity.generated.mjs'
const RESULT_MARKER = '__BOOTSTRAP_RUN_RESULT__'
/**
 * The Jest budget deliberately exceeds the spawn budget, so a wedged child is
 * reported as this file's own "runner produced no result" error — with the
 * child's output attached — rather than as an opaque Jest timeout.
 */
const CHILD_SPAWN_TIMEOUT_MS = 120_000
const CHILD_RUN_TIMEOUT_MS = 180_000

const LOADER_PATH = path.resolve(__dirname, '..', 'dynamicLoader.ts')

/**
 * Resolved through a real `require` rather than Jest's resolver: this path is
 * handed to a child process, so it must be the location Node itself would load.
 */
const TSX_CLI_PATH = createRequire(__filename).resolve('tsx/cli')

/**
 * Runs one loadBootstrapData against the fixture app root and reports the
 * outcome on stdout behind a marker, so the loader's own logging (and the
 * recovery module's console.warn banner) cannot be mistaken for the result.
 */
const RUNNER_SOURCE = [
  "import { pathToFileURL } from 'node:url'",
  '',
  'const [loaderPath, appRoot] = process.argv.slice(2)',
  '',
  'let result',
  'try {',
  '  const loader = await import(pathToFileURL(loaderPath).href)',
  '  await loader.loadBootstrapData(appRoot)',
  '  result = { loaded: true }',
  '} catch (error) {',
  '  result = { loaded: false, message: error instanceof Error ? error.message : String(error) }',
  '}',
  '',
  `process.stdout.write('\\n' + ${JSON.stringify(RESULT_MARKER)} + JSON.stringify(result))`,
].join('\n')

/**
 * Split so the literal never appears in this file: the repository's Jest
 * transformer rewrites every `import.meta` occurrence to a CommonJS stub before
 * ts-jest sees the source, including ones inside a string.
 */
const IMPORT_META_URL_EXPRESSION = ['import', '.meta.url'].join('')

/**
 * The decorator import is assembled at runtime rather than written literally:
 * a literal would make this fixture itself match the startup scan's staleness
 * pattern, so the scan would delete the cache before the import ever runs and
 * the import-time path under test would never be exercised.
 */
const REJECTING_COMPILED_SOURCE = [
  "import nodeFs from 'node:fs'",
  "import nodePath from 'node:path'",
  "import { fileURLToPath } from 'node:url'",
  'const quote = String.fromCharCode(39)',
  "const staleImport = 'import { Entity, PrimaryKey } from ' + quote + '@mikro-orm/core' + quote",
  `const generatedDirPath = fileURLToPath(new URL('.', ${IMPORT_META_URL_EXPRESSION}))`,
  `nodeFs.writeFileSync(nodePath.join(generatedDirPath, ${JSON.stringify(STALE_SIBLING_BASENAME)}), staleImport + '\\nexport const stale = true\\n')`,
  `throw new Error('The requested module ' + quote + '@mikro-orm/core' + quote + ' does not provide an export named ' + quote + 'Entity' + quote)`,
].join('\n')

/**
 * The generated sources stay honest ESM. The loader compiles them with esbuild
 * and the child process imports that output natively, so nothing here has to
 * model the compiled shape — the loader's real output is what gets imported.
 */
const GENERATED_MODULES: Record<string, string> = {
  'entities.ids.generated': 'export const E = {}',
  'modules.cli.generated': 'export const modules = []',
  'entities.generated': 'export const entities = []',
  'di.generated': 'export const diRegistrars = []',
}

type BootstrapRunResult = { loaded: boolean; message?: string }

function contentHash(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Replace a compiled cache entry with staged content, keeping the loader's own
 * cache metadata authoritative.
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

describe('compileAndImport — generated-cache recovery is reachable (#4526)', () => {
  let runnerDir: string
  let runnerPath: string
  let templateRoot: string
  let appRoot: string
  let generatedDir: string

  function runLoaderInChildProcess(target: string): BootstrapRunResult {
    const run = spawnSync(process.execPath, [TSX_CLI_PATH, runnerPath, LOADER_PATH, target], {
      encoding: 'utf8',
      timeout: CHILD_SPAWN_TIMEOUT_MS,
      env: { ...process.env, OM_LOG_LEVEL: 'error' },
    })

    const markerIndex = (run.stdout ?? '').lastIndexOf(RESULT_MARKER)
    if (markerIndex === -1) {
      throw new Error(
        `[internal] bootstrap runner reported no result (status ${run.status})\n`
          + `stdout: ${run.stdout}\nstderr: ${run.stderr}`,
      )
    }

    return JSON.parse(run.stdout.slice(markerIndex + RESULT_MARKER.length)) as BootstrapRunResult
  }

  function createFixtureAppRoot(prefix: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    fs.mkdirSync(path.join(root, '.mercato', 'generated'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext' } }),
    )
    for (const [baseName, source] of Object.entries(GENERATED_MODULES)) {
      fs.writeFileSync(path.join(root, '.mercato', 'generated', `${baseName}.ts`), source)
    }
    return root
  }

  /**
   * Prime once: a single child-process load compiles every generated source and
   * writes the loader's real cache metadata for it. The primed tree is copied
   * per test rather than re-primed — the cache records source and tsconfig
   * hashes plus app-root-relative dependency paths, so it stays valid under a
   * different root.
   */
  beforeAll(() => {
    runnerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-4526-runner-'))
    runnerPath = path.join(runnerDir, 'load-bootstrap-data.mjs')
    fs.writeFileSync(runnerPath, RUNNER_SOURCE)

    templateRoot = createFixtureAppRoot('om-bootstrap-4526-template-')
    const primed = runLoaderInChildProcess(templateRoot)
    if (!primed.loaded) {
      throw new Error(`[internal] fixture priming failed: ${primed.message}`)
    }
    if (fs.existsSync(path.join(templateRoot, '.mercato', 'generated', '.mikro-orm-v7-cache-recovery.json'))) {
      throw new Error('[internal] fixture priming triggered cache recovery')
    }
  }, CHILD_RUN_TIMEOUT_MS)

  afterAll(() => {
    for (const directory of [templateRoot, runnerDir]) {
      if (directory) fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-4526-'))
    fs.cpSync(templateRoot, appRoot, { recursive: true })
    generatedDir = path.join(appRoot, '.mercato', 'generated')
  })

  afterEach(() => {
    fs.rmSync(appRoot, { recursive: true, force: true })
  })

  it('runs cache recovery when the compiled cache rejects on import', () => {
    const rejectingPath = path.join(generatedDir, 'entities.ids.generated.mjs')
    stageCompiledCache(generatedDir, 'entities.ids.generated', REJECTING_COMPILED_SOURCE)

    const run = runLoaderInChildProcess(appRoot)

    const markerPath = path.join(generatedDir, '.mikro-orm-v7-cache-recovery.json')
    expect(fs.existsSync(markerPath)).toBe(true)

    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    expect(marker.reason).toBe('runtime-import-error')
    expect(marker.deletedFiles).toContain(rejectingPath)
    expect(marker.deletedFiles).toContain(path.join(generatedDir, STALE_SIBLING_BASENAME))

    expect(fs.readFileSync(rejectingPath, 'utf8')).not.toContain('does not provide an export named')
    expect(run).toEqual({ loaded: true })
  }, CHILD_RUN_TIMEOUT_MS)

  it('does not run recovery when the compiled cache imports cleanly', () => {
    const run = runLoaderInChildProcess(appRoot)

    expect(run).toEqual({ loaded: true })
    expect(fs.existsSync(path.join(generatedDir, '.mikro-orm-v7-cache-recovery.json'))).toBe(false)
  }, CHILD_RUN_TIMEOUT_MS)
})
