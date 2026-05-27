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

import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { existsSync, readFileSync, readdirSync, watch as fsWatch } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAtomicWritePlugin } from './lib/add-js-extension.mjs'

const REBUILD_DEBOUNCE_MS = 100
const here = fileURLToPath(new URL('.', import.meta.url))
const defaultRepoRoot = join(here, '..')

export function isWatchedSourceFile(filename) {
  if (!filename) return false
  if (!filename.endsWith('.ts') && !filename.endsWith('.tsx')) return false
  if (filename.includes('__tests__') || filename.includes('.test.')) return false
  return true
}

function safeReadPackageJson(packageDir) {
  const pkgPath = join(packageDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }
}

export function discoverWorkspacePackages(root) {
  const roots = [
    join(root, 'packages'),
    join(root, 'external', 'official-modules', 'packages'),
  ]
  const discovered = []

  for (const parent of roots) {
    if (!existsSync(parent)) continue
    let entries
    try {
      entries = readdirSync(parent, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const packageDir = join(parent, entry.name)
      const pkg = safeReadPackageJson(packageDir)
      if (!pkg) continue
      if (!pkg.scripts?.watch) continue
      const srcDir = join(packageDir, 'src')
      if (!existsSync(srcDir)) continue

      discovered.push({
        name: pkg.name ?? basename(packageDir),
        packageDir,
        srcDir,
        shortLabel: basename(packageDir),
      })
    }
  }

  discovered.sort((a, b) => a.shortLabel.localeCompare(b.shortLabel))
  return discovered
}

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

function makePackageState(pkg) {
  return {
    ...pkg,
    rebuildTimeout: null,
    isRebuilding: false,
    rebuildQueued: false,
    watcher: null,
  }
}

async function rebuildPackage(state, { log, build = esbuild.build }) {
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
      log(`[watch] ${state.shortLabel}: rebuild complete`)
    } catch (error) {
      log(`[watch] ${state.shortLabel}: rebuild failed: ${error?.message ?? error}`, 'error')
    } finally {
      state.isRebuilding = false
    }
  } while (state.rebuildQueued)
}

function startPackageWatcher(state, { log, build }) {
  const onChange = (_eventType, filename) => {
    if (!isWatchedSourceFile(filename)) return
    if (state.rebuildTimeout) clearTimeout(state.rebuildTimeout)
    state.rebuildTimeout = setTimeout(() => {
      state.rebuildTimeout = null
      void rebuildPackage(state, { log, build })
    }, REBUILD_DEBOUNCE_MS)
  }

  try {
    state.watcher = fsWatch(state.srcDir, { recursive: true }, onChange)
  } catch (error) {
    log(
      `[watch] ${state.shortLabel}: failed to start fs.watch: ${error?.message ?? error}`,
      'error',
    )
  }
}

function defaultLog(line, level = 'info') {
  if (level === 'error') console.error(line)
  else console.log(line)
}

export async function runConsolidatedWatch({
  root = defaultRepoRoot,
  log = defaultLog,
  signal,
  build,
} = {}) {
  const packages = discoverWorkspacePackages(root)
  if (packages.length === 0) {
    log(
      '[watch] no workspace packages with a `watch` script and `src/` directory were found',
      'error',
    )
    return { packages: [] }
  }

  const states = packages.map(makePackageState)
  log(
    `[watch] consolidated watcher: tracking ${states.length} package${states.length === 1 ? '' : 's'} (${states
      .map((state) => state.shortLabel)
      .join(', ')})`,
  )

  for (const state of states) {
    startPackageWatcher(state, { log, build })
  }

  const cleanup = () => {
    log('\n[watch] consolidated watcher: stopping...')
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

  return { packages: states, cleanup }
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
  await runConsolidatedWatch()
  await new Promise(() => {})
}
