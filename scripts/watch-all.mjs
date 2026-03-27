/**
 * Phase 6 — Single-process watch coordinator with package-level fault isolation.
 * Phase 7 — Generator invalidation and auto-regeneration.
 * Phase 8 — Package rebuild / generator rerun ordering.
 * Phase 9 — Manifest-based readiness contract.
 *
 * Usage: node scripts/watch-all.mjs [--session <id>]
 *
 * Writes a readiness manifest to .mercato/dev-watch/manifest.json
 */

import * as esbuild from 'esbuild'
import { existsSync, mkdirSync, writeFileSync, watch as fsWatch } from 'node:fs'
import { join, basename, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  resolveRuntimePackageDirs,
  getDefaultBuildOptions,
  loadBuildConfig,
  copyJsonFiles,
} from './build-shared.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolvePath(__dirname, '..')
const MANIFEST_DIR = join(ROOT_DIR, '.mercato', 'dev-watch')
const MANIFEST_PATH = join(MANIFEST_DIR, 'manifest.json')

// Parse session ID from args or generate one
const sessionArg = process.argv.indexOf('--session')
const SESSION_ID = sessionArg !== -1
  ? process.argv[sessionArg + 1]
  : `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`

// ── Manifest state ──

const manifest = {
  sessionId: SESSION_ID,
  status: 'starting',
  heartbeatAt: new Date().toISOString(),
  packageRunSeq: 0,
  generatorRunSeq: 0,
  packages: {},
  generator: {
    status: 'idle',
    runSeq: 0,
    lastStartedAt: null,
    lastSuccessAt: null,
    lastEventAt: null,
    error: null,
  },
}

function writeManifest() {
  manifest.heartbeatAt = new Date().toISOString()
  mkdirSync(MANIFEST_DIR, { recursive: true })
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
}

function setPackageStatus(pkgName, status, extra = {}) {
  if (!manifest.packages[pkgName]) {
    manifest.packages[pkgName] = {
      status: 'idle',
      buildSeq: 0,
      lastCompletedSeq: 0,
      lastEventAt: null,
      lastSuccessAt: null,
      error: null,
    }
  }
  Object.assign(manifest.packages[pkgName], { status, lastEventAt: new Date().toISOString(), ...extra })
  writeManifest()
}

function allPackagesReady() {
  return Object.values(manifest.packages).every(p => p.status === 'ready')
}

function anyPackageFailed() {
  return Object.values(manifest.packages).some(p => p.status === 'failed')
}

// ── Heartbeat ──

const heartbeatInterval = setInterval(() => writeManifest(), 1500)

// ── JSON-copying packages ──

const JSON_COPY_PACKAGES = new Set([
  'core', 'enterprise', 'ai-assistant', 'search', 'scheduler',
])
const CORE_JSON_IGNORE = ['**/i18n/**']

// ── Package watch contexts ──

const watchContexts = []

async function createPackageWatcher(packageDir) {
  const pkgName = basename(packageDir)
  setPackageStatus(pkgName, 'building', { buildSeq: (manifest.packages[pkgName]?.buildSeq || 0) + 1 })

  try {
    const config = await loadBuildConfig(packageDir)
    let options
    let postBuildFn = null
    let extraContextDefs = []

    if (config?.getBuildOptions) {
      options = await config.getBuildOptions(packageDir, { target: 'node24', incremental: true })
      postBuildFn = config.postBuild || null
      if (config.getExtraContexts) {
        extraContextDefs = await config.getExtraContexts(packageDir, esbuild, { target: 'node24', incremental: true })
      }
    } else {
      options = await getDefaultBuildOptions(packageDir, { target: 'node24', incremental: true })
    }

    if (options.entryPoints.length === 0) {
      console.log(`[watch-all] ${pkgName}: no source files, skipping`)
      setPackageStatus(pkgName, 'ready')
      return
    }

    // Wrap the plugin to track readiness
    const originalPlugins = options.plugins || []
    const trackingPlugin = {
      name: 'watch-all-tracker',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length > 0) {
            console.error(`[watch-all] ${pkgName}: build failed (${result.errors.length} errors)`)
            setPackageStatus(pkgName, 'failed', {
              error: result.errors.map(e => e.text).join('; '),
            })
            return
          }

          // Run post-build steps (JSON copy, etc.)
          try {
            if (postBuildFn) {
              await postBuildFn(packageDir)
            } else if (JSON_COPY_PACKAGES.has(pkgName)) {
              const ignore = pkgName === 'core' ? CORE_JSON_IGNORE : []
              await copyJsonFiles(packageDir, { ignore })
            }
          } catch (err) {
            console.error(`[watch-all] ${pkgName}: post-build failed:`, err.message)
          }

          manifest.packageRunSeq++
          setPackageStatus(pkgName, 'ready', {
            lastCompletedSeq: manifest.packages[pkgName].buildSeq,
            lastSuccessAt: new Date().toISOString(),
            error: null,
          })
          console.log(`[watch-all] ${pkgName}: ready`)

          // Check if structural change needs generator rerun (Phase 8)
          checkGeneratorTrigger(pkgName)
        })
      },
    }

    options.plugins = [...originalPlugins, trackingPlugin]
    options.logLevel = 'warning'

    const ctx = await esbuild.context(options)
    watchContexts.push({ name: pkgName, ctx })
    await ctx.watch()

    // Extra contexts (e.g., core generated/)
    for (const extra of extraContextDefs) {
      const extraCtx = await esbuild.context({
        ...extra.options,
        logLevel: 'warning',
      })
      watchContexts.push({ name: extra.label, ctx: extraCtx })
      await extraCtx.watch()
    }
  } catch (err) {
    console.error(`[watch-all] ${pkgName}: failed to create watcher:`, err.message)
    setPackageStatus(pkgName, 'failed', { error: err.message })
  }
}

// ── Phase 7 — Generator invalidation ──

let generatorQueued = false
let generatorRunning = false
let generatorDebounceTimer = null
let pendingStructuralPackages = new Set()

function isGeneratorTriggerFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const fileName = segments[segments.length - 1]

  // Check directory-based patterns (files inside auto-discovery directories)
  const directoryTriggers = ['frontend', 'backend', 'api', 'subscribers', 'workers',
    'widgets/injection', 'widgets/dashboard']
  for (const dir of directoryTriggers) {
    if (normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)) return true
  }

  // Check exact filename patterns (convention files at module root or known paths)
  const filenameTriggers = [
    'index.ts', 'di.ts', 'acl.ts', 'setup.ts', 'ce.ts', 'search.ts',
    'events.ts', 'translations.ts', 'notifications.ts', 'notifications.client.ts',
    'notifications.handlers.ts', 'ai-tools.ts', 'generators.ts',
    'injection-table.ts', 'components.ts',
  ]
  if (filenameTriggers.includes(fileName)) return true

  // Check path-specific patterns
  const pathTriggers = ['data/extensions.ts', 'data/enrichers.ts', 'api/interceptors.ts']
  for (const p of pathTriggers) {
    if (normalized.endsWith(p)) return true
  }

  return false
}

function checkGeneratorTrigger(pkgName) {
  if (pendingStructuralPackages.has(pkgName)) {
    pendingStructuralPackages.delete(pkgName)
    scheduleGeneratorRun()
  }
}

function scheduleGeneratorRun() {
  if (generatorDebounceTimer) clearTimeout(generatorDebounceTimer)
  generatorDebounceTimer = setTimeout(runGenerator, 200)
}

async function runGenerator() {
  if (generatorRunning) {
    generatorQueued = true
    return
  }

  generatorRunning = true
  manifest.generator.runSeq++
  manifest.generator.status = 'running'
  manifest.generator.lastStartedAt = new Date().toISOString()
  manifest.generator.lastEventAt = new Date().toISOString()
  manifest.generatorRunSeq++
  writeManifest()

  console.log('[watch-all] generator: running...')

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        join(ROOT_DIR, 'packages', 'cli', 'dist', 'bin.js'),
        'generate', 'all', '--quiet',
      ], {
        cwd: join(ROOT_DIR, 'apps', 'mercato'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        timeout: 60000,
      })

      let stderr = ''
      child.stderr.on('data', (d) => { stderr += d.toString() })
      child.stdout.on('data', () => {})

      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Generator exited with code ${code}: ${stderr.slice(0, 500)}`))
      })
      child.on('error', reject)
    })

    manifest.generator.status = 'ready'
    manifest.generator.lastSuccessAt = new Date().toISOString()
    manifest.generator.error = null
    console.log('[watch-all] generator: complete')
  } catch (err) {
    console.error('[watch-all] generator: failed:', err.message)
    manifest.generator.status = 'failed'
    manifest.generator.error = err.message

    if (manifest.status === 'ready') {
      manifest.status = 'degraded'
      console.warn('[watch-all] session degraded — generator failed. Fix the issue and save to retry.')
    }
  }

  manifest.generator.lastEventAt = new Date().toISOString()
  writeManifest()
  generatorRunning = false

  if (generatorQueued) {
    generatorQueued = false
    scheduleGeneratorRun()
  }
}

// ── Phase 7 — Watch for structural changes in module source directories ──

const fsWatchers = []

function watchModuleSources() {
  const moduleDirs = []

  // Package module sources
  for (const pkgName of ['core', 'enterprise', 'webhooks', 'checkout', 'ai-assistant',
    'content', 'onboarding', 'gateway-stripe', 'sync-akeneo', 'scheduler']) {
    const srcModules = join(ROOT_DIR, 'packages', pkgName, 'src', 'modules')
    if (existsSync(srcModules)) moduleDirs.push({ dir: srcModules, isPackage: true, pkgName })
  }

  // App-local modules
  const appModules = join(ROOT_DIR, 'apps', 'mercato', 'src', 'modules')
  if (existsSync(appModules)) moduleDirs.push({ dir: appModules, isPackage: false, pkgName: null })

  // Also watch the modules.ts enablement file
  const modulesTs = join(ROOT_DIR, 'apps', 'mercato', 'src', 'modules.ts')

  for (const { dir, isPackage, pkgName } of moduleDirs) {
    try {
      const watcher = fsWatch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return
        if (filename.endsWith('.d.ts')) return
        if (filename.includes('node_modules')) return
        if (filename.includes('__tests__')) return

        if (isGeneratorTriggerFile(filename)) {
          console.log(`[watch-all] structural change: ${filename} in ${pkgName || 'app'}`)
          if (isPackage && pkgName) {
            // Phase 8: wait for package rebuild before running generator
            pendingStructuralPackages.add(pkgName)
          } else {
            // App-local: trigger generator directly
            scheduleGeneratorRun()
          }
        }
      })
      fsWatchers.push(watcher)
    } catch (err) {
      console.warn(`[watch-all] cannot watch ${dir}: ${err.message}`)
    }
  }

  // Watch modules.ts
  if (existsSync(modulesTs)) {
    try {
      const modulesTsDir = dirname(modulesTs)
      const watcher = fsWatch(modulesTsDir, (eventType, filename) => {
        if (filename === 'modules.ts') {
          console.log('[watch-all] structural change: modules.ts')
          scheduleGeneratorRun()
        }
      })
      fsWatchers.push(watcher)
    } catch (err) {
      console.warn(`[watch-all] cannot watch modules.ts: ${err.message}`)
    }
  }
}

// ── Startup ──

function waitForAllPackages(timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      if (anyPackageFailed()) {
        reject(new Error('One or more packages failed initial build'))
        return
      }
      if (allPackagesReady()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        const pending = Object.entries(manifest.packages)
          .filter(([, p]) => p.status !== 'ready')
          .map(([n, p]) => `${n}:${p.status}`)
        reject(new Error(`Timed out waiting for packages: ${pending.join(', ')}`))
        return
      }
      setTimeout(check, 200)
    }
    check()
  })
}

async function start() {
  // Clean stale manifest from previous sessions
  mkdirSync(MANIFEST_DIR, { recursive: true })

  console.log(`[watch-all] session: ${SESSION_ID}`)
  const packageDirs = resolveRuntimePackageDirs(ROOT_DIR)
  console.log(`[watch-all] starting unified watcher for ${packageDirs.length} packages...`)

  writeManifest()

  // Create all watchers (esbuild contexts start watching immediately)
  await Promise.all(packageDirs.map(dir => createPackageWatcher(dir)))

  // Wait for all initial builds to complete
  try {
    await waitForAllPackages()
  } catch (err) {
    console.error(`[watch-all] ${err.message}`)
    manifest.status = 'failed'
    writeManifest()
    // Keep running so developers can fix and save
  }

  if (!anyPackageFailed()) {
    // Run initial generator pass
    console.log('[watch-all] all packages ready, running initial generator pass...')
    await runGenerator()

    if (manifest.generator.status === 'ready') {
      manifest.status = 'ready'
      console.log('[watch-all] session ready')
    } else {
      console.error('[watch-all] initial generator failed — session blocked')
      manifest.status = 'failed'
    }
  }

  writeManifest()

  // Start watching for structural changes
  watchModuleSources()
}

// ── Cleanup ──

async function cleanup(signal) {
  console.log(`\n[watch-all] received ${signal}, shutting down...`)
  clearInterval(heartbeatInterval)
  if (generatorDebounceTimer) clearTimeout(generatorDebounceTimer)

  // Close fs watchers for structural change detection
  for (const watcher of fsWatchers) {
    try { watcher.close() } catch { /* ignore */ }
  }

  manifest.status = 'dead'
  writeManifest()

  for (const { ctx } of watchContexts) {
    try {
      await ctx.dispose()
    } catch {
      // ignore
    }
  }

  process.exit(0)
}

process.on('SIGINT', () => cleanup('SIGINT'))
process.on('SIGTERM', () => cleanup('SIGTERM'))
process.on('uncaughtException', (err) => {
  console.error('[watch-all] uncaught exception:', err)
  clearInterval(heartbeatInterval)
  manifest.status = 'dead'
  manifest.generator.error = err.message
  writeManifest()
  process.exit(1)
})

await start()
