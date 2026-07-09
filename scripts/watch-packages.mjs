#!/usr/bin/env node
// Consolidated workspace package watcher.
//
// Replaces `turbo run watch --filter='./packages/*' --concurrency=32` by
// driving every workspace package's esbuild rebuild from a single Node
// process. Idle RSS measured against this monorepo's 18 packages dropped
// from ~1.13 GB (Turbo + 18 child watchers) to ~125 MB. See
// `.ai/runs/2026-05-27-dev-mode-package-watch-consolidation/PLAN.md`.
//
// Behavior parity with `packages/<pkg>/watch.mjs` (which delegates to
// `scripts/watch.mjs`'s `low-memory` mode):
//   - one-shot `esbuild.build` per change, no persistent context held idle;
//   - re-globs entry points before every rebuild so brand-new files emit;
//   - 100 ms per-package debounce coalesces editor save flurries;
//   - emits the same `[watch] <pkg>: rebuilding...` / `rebuild complete`
//     lines so `scripts/dev.mjs` log filters keep working.
//
// Escape hatch: set `OM_WATCH_PACKAGES_MODE=legacy` to fall back to the
// previous Turbo-based per-package watcher path (see `package.json`).
//
// Note: this var is distinct from `OM_PACKAGE_WATCH_MODE` (see
// `scripts/watch.mjs`), which only takes effect under the legacy path and
// toggles per-package `low-memory` vs `persistent` modes. The consolidated
// watcher always runs in the low-memory equivalent. See
// `apps/docs/docs/appendix/troubleshooting.mdx` for the public reference.

import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { existsSync, readFileSync, readdirSync, watch as fsWatch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAtomicWritePlugin } from './lib/add-js-extension.mjs'
import {
  AUTO_EXPAND_INTERVAL_MS,
  detectTouchedPackages,
  discoverWatchTargets,
  resolveWatchScope,
  selectWatchedPackages,
} from './watch-scope.mjs'

const REBUILD_DEBOUNCE_MS = 100
const TOUCHABLE_GENERATED_PATTERN = /\.generated(?:\.[a-z0-9]+)?(?:\.ts|\.checksum)$/i
const here = fileURLToPath(new URL('.', import.meta.url))
const defaultRepoRoot = join(here, '..')

export function isWatchedSourceFile(filename) {
  if (!filename) return false
  if (!filename.endsWith('.ts') && !filename.endsWith('.tsx') && !filename.endsWith('.json')) return false
  if (filename.includes('__tests__') || filename.includes('.test.')) return false
  return true
}

// Re-exported from `watch-scope.mjs` (the dependency-light shared discovery
// source) so existing importers and tests keep the same entry point.
export const discoverWorkspacePackages = discoverWatchTargets

function createBuildOptions(packageDir, entryPoints) {
  return {
    absWorkingDir: packageDir,
    entryPoints,
    outdir: join(packageDir, 'dist'),
    outbase: join(packageDir, 'src'),
    format: 'esm',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    jsx: 'automatic',
    write: false,
    plugins: [createAtomicWritePlugin()],
    logLevel: 'warning',
  }
}

async function globEntryPoints(packageDir) {
  return glob('src/**/*.{ts,tsx}', {
    cwd: packageDir,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    absolute: true,
  })
}

export function discoverAppGeneratedDirs(root) {
  const candidates = []
  const rootGenerated = join(root, '.mercato', 'generated')
  if (existsSync(rootGenerated)) candidates.push(rootGenerated)

  const appsDir = join(root, 'apps')
  if (existsSync(appsDir)) {
    let appEntries = []
    try {
      appEntries = readdirSync(appsDir, { withFileTypes: true })
    } catch {
      appEntries = []
    }

    for (const entry of appEntries) {
      if (!entry.isDirectory()) continue
      candidates.push(join(appsDir, entry.name, '.mercato', 'generated'))
    }
  }

  return candidates.filter((dir) => {
    try {
      return existsSync(dir)
    } catch {
      return false
    }
  })
}

export function touchGeneratedBarrels(generatedDirs, { log = defaultLog } = {}) {
  let touchedCount = 0
  for (const generatedDir of generatedDirs) {
    let entries = []
    try {
      entries = readdirSync(generatedDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!TOUCHABLE_GENERATED_PATTERN.test(entry.name)) continue
      const filePath = join(generatedDir, entry.name)
      try {
        writeFileSync(filePath, readFileSync(filePath))
        touchedCount += 1
      } catch (error) {
        log(
          `[watch] failed to touch generated barrel ${filePath}: ${error?.message ?? error}`,
          'error',
        )
      }
    }
  }
  return touchedCount
}

function makePackageState(pkg) {
  return {
    ...pkg,
    rebuildTimeout: null,
    isRebuilding: false,
    rebuildQueued: false,
    watcher: null,
    watchError: null,
  }
}

async function rebuildPackage(state, { log, build = esbuild.build, generatedDirs = [] }) {
  if (state.isRebuilding) {
    state.rebuildQueued = true
    return
  }

  do {
    state.rebuildQueued = false
    state.isRebuilding = true
    try {
      const points = await globEntryPoints(state.packageDir)
      if (points.length === 0) {
        log(`[watch] ${state.shortLabel}: no source files found, skipping rebuild`)
        continue
      }
      log(`[watch] ${state.shortLabel}: rebuilding...`)
      await build(createBuildOptions(state.packageDir, points))
      touchGeneratedBarrels(generatedDirs, { log })
      log(`[watch] ${state.shortLabel}: rebuild complete`)
    } catch (error) {
      log(`[watch] ${state.shortLabel}: rebuild failed: ${error?.message ?? error}`, 'error')
    } finally {
      state.isRebuilding = false
    }
  } while (state.rebuildQueued)
}

function startPackageWatcher(state, { log, build, generatedDirs, watch = fsWatch }) {
  const onChange = (_eventType, filename) => {
    if (!isWatchedSourceFile(filename)) return
    if (state.rebuildTimeout) clearTimeout(state.rebuildTimeout)
    state.rebuildTimeout = setTimeout(() => {
      state.rebuildTimeout = null
      void rebuildPackage(state, { log, build, generatedDirs })
    }, REBUILD_DEBOUNCE_MS)
  }

  try {
    state.watcher = watch(state.srcDir, { recursive: true }, onChange)
    return true
  } catch (error) {
    state.watchError = error
    log(
      `[watch] ${state.shortLabel}: failed to start fs.watch: ${error?.message ?? error}`,
      'error',
    )
    return false
  }
}

function defaultLog(line, level = 'info') {
  if (level === 'error') console.error(line)
  else console.log(line)
}

// When `signal` is supplied, the function resolves immediately after
// registering watchers and abort cleanup; the caller is responsible for
// keeping the event loop alive (e.g. its own `await new Promise(() => {})`
// or a `setInterval` heartbeat). The standalone CLI invocation path below
// pins the loop itself via `await new Promise(() => {})`, so external
// programmatic callers do not need to.
export async function runConsolidatedWatch({
  root = defaultRepoRoot,
  log = defaultLog,
  signal,
  build,
  watch,
} = {}) {
  const { env = process.env, argv = process.argv.slice(2), runGit } = arguments[0] ?? {}
  const allPackages = discoverWorkspacePackages(root)
  const generatedDirs = discoverAppGeneratedDirs(root)
  if (allPackages.length === 0) {
    log(
      '[watch] no workspace packages with a `watch` script and `src/` directory were found',
      'error',
    )
    return { packages: [] }
  }

  const scopeConfig = resolveWatchScope({ env, argv })
  const selection = selectWatchedPackages({ packages: allPackages, config: scopeConfig, root, runGit })
  const selected = selection.selected.length ? selection.selected : allPackages

  if (selection.mode !== 'all') {
    log(`[watch] watch scope: ${selection.mode} — ${selection.reason}`)
    const excluded = allPackages.length - selected.length
    if (excluded > 0) {
      log(`[watch] watch scope: ${excluded} of ${allPackages.length} package(s) are not watched (set OM_WATCH_SCOPE=all to watch everything)`)
    }
  }

  const states = selected.map(makePackageState)
  const watchedLabels = new Set(states.map((state) => state.shortLabel))
  let expandTimer = null
  log(
    `[watch] consolidated watcher: tracking ${states.length} package${states.length === 1 ? '' : 's'} (${states
      .map((state) => state.shortLabel)
      .join(', ')})`,
  )

  let startedCount = 0
  for (const state of states) {
    if (startPackageWatcher(state, { log, build, generatedDirs, watch })) {
      startedCount += 1
    }
  }

  if (startedCount !== states.length) {
    log(
      `[watch] consolidated watcher: failed to start ${states.length - startedCount} of ${states.length} package watchers`,
      'error',
    )
  }

  const cleanup = () => {
    log('\n[watch] consolidated watcher: stopping...')
    if (expandTimer) {
      clearInterval(expandTimer)
      expandTimer = null
    }
    for (const state of states) {
      if (state.rebuildTimeout) {
        clearTimeout(state.rebuildTimeout)
        state.rebuildTimeout = null
      }
      try {
        state.watcher?.close()
      } catch {}
    }
  }

  // `auto-optimized` keeps re-checking which packages changed and expands the
  // watch set (it never removes a watcher once started).
  if (selection.autoExpand) {
    const expandWatchers = () => {
      let touched
      try {
        touched = detectTouchedPackages({ packages: allPackages, root, config: scopeConfig, runGit })
      } catch {
        return
      }
      for (const pkg of touched) {
        if (watchedLabels.has(pkg.shortLabel)) continue
        const state = makePackageState(pkg)
        if (startPackageWatcher(state, { log, build, generatedDirs, watch })) {
          states.push(state)
          watchedLabels.add(state.shortLabel)
          log(`[watch] watch scope: expanded to newly-touched package ${state.shortLabel}`)
          void rebuildPackage(state, { log, build, generatedDirs })
        }
      }
    }
    expandTimer = setInterval(expandWatchers, AUTO_EXPAND_INTERVAL_MS)
    if (typeof expandTimer.unref === 'function') expandTimer.unref()
  }

  if (signal) {
    if (signal.aborted) {
      cleanup()
      return { packages: states, cleanup }
    }
    signal.addEventListener('abort', cleanup, { once: true })
  } else {
    const onSignal = () => {
      cleanup()
      process.exit(0)
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  }

  return { packages: states, cleanup, failed: startedCount !== states.length }
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  const keepAlive = setInterval(() => {}, 60000)
  runConsolidatedWatch().catch((error) => {
    clearInterval(keepAlive)
    console.error(`[watch] consolidated watcher failed: ${error?.message ?? error}`)
    process.exit(1)
  }).then((result) => {
    if (result?.failed || result?.packages?.length === 0) {
      clearInterval(keepAlive)
      result.cleanup?.()
      process.exit(1)
    }
  })
}
