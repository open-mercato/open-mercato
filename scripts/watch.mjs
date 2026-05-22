import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { watch as fsWatch } from 'node:fs'
import { basename, join } from 'node:path'
import { createAtomicWritePlugin } from './lib/add-js-extension.mjs'

function resolvePackageWatchMode() {
  const raw = process.env.OM_PACKAGE_WATCH_MODE ?? process.env.MERCATO_PACKAGE_WATCH_MODE
  const normalized = String(raw ?? '').trim().toLowerCase()

  if (['persistent', 'incremental', 'esbuild', 'legacy'].includes(normalized)) {
    return 'persistent'
  }

  return 'low-memory'
}

/**
 * Start watching a package for changes and rebuild dist output.
 * @param {string} packageDir - Absolute path to the package directory
 */
export async function watch(packageDir) {
  const packageName = basename(packageDir)
  const watchMode = resolvePackageWatchMode()

  // The esbuild context is created with a snapshot of the entry-point list.
  // When new source files are added at runtime (e.g. a new component that
  // an existing entry point imports), esbuild keeps following its original
  // list and never emits a dist file for the new module — at runtime Node
  // then fails to resolve the relative `./NewModule.js` import. Re-glob on
  // every change and recreate the context when the set actually changes.
  const globEntryPoints = async () => {
    return await glob('src/**/*.{ts,tsx}', {
      cwd: packageDir,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
      absolute: true,
    })
  }

  let entryPoints = await globEntryPoints()

  if (entryPoints.length === 0) {
    console.log(`[watch] ${packageName}: no source files found, skipping`)
    return
  }

  const createBuildOptions = (points) => ({
    absWorkingDir: packageDir,
    entryPoints: points,
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
  })

  if (watchMode === 'low-memory') {
    console.log(`[watch] ${packageName}: watching for changes (low-memory one-shot rebuilds)...`)
    await watchWithOneShotBuilds({
      packageDir,
      packageName,
      globEntryPoints,
      createBuildOptions,
    })
    return
  }

  let ctx = await esbuild.context(createBuildOptions(entryPoints))
  let entrySet = new Set(entryPoints)

  /** Re-glob entry points; recreate the context when the list has changed. */
  const refreshEntryPointsIfChanged = async () => {
    const next = await globEntryPoints()
    const nextSet = new Set(next)
    if (nextSet.size === entrySet.size) {
      let same = true
      for (const item of entrySet) {
        if (!nextSet.has(item)) {
          same = false
          break
        }
      }
      if (same) return false
    }
    console.log(
      `[watch] ${packageName}: entry points changed (was ${entrySet.size}, now ${nextSet.size}), recreating context...`,
    )
    await ctx.dispose()
    entryPoints = next
    entrySet = nextSet
    ctx = await esbuild.context(createBuildOptions(entryPoints))
    return true
  }

  const cleanup = async () => {
    console.log(`\n[watch] ${packageName}: stopping...`)
    await ctx.dispose()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  console.log(`[watch] ${packageName}: watching for changes (persistent esbuild context)...`)
  await watchWithPersistentContext(() => ctx, packageDir, packageName, refreshEntryPointsIfChanged)
}

/**
 * Low-memory watcher using Node.js fs.watch and one-shot esbuild builds.
 *
 * `yarn dev` already runs a full package build before starting watch mode, so
 * idle watchers do not need to hold one esbuild context per package. Rebuilds
 * are slightly colder after a change, but idle RSS stays bounded by lightweight
 * Node watcher processes instead of long-lived esbuild graphs.
 */
async function watchWithOneShotBuilds({
  packageDir,
  packageName,
  globEntryPoints,
  createBuildOptions,
}) {
  const srcDir = join(packageDir, 'src')
  let rebuildTimeout = null
  let isRebuilding = false
  let rebuildQueued = false

  const runBuild = async () => {
    if (isRebuilding) {
      rebuildQueued = true
      return
    }

    do {
      rebuildQueued = false
      isRebuilding = true
      try {
        const points = await globEntryPoints()
        if (points.length === 0) {
          console.log(`[watch] ${packageName}: no source files found, skipping rebuild`)
          continue
        }
        console.log(`[watch] ${packageName}: rebuilding...`)
        await esbuild.build(createBuildOptions(points))
        console.log(`[watch] ${packageName}: rebuild complete`)
      } catch (error) {
        console.error(`[watch] ${packageName}: rebuild failed:`, error?.message ?? error)
      } finally {
        isRebuilding = false
      }
    } while (rebuildQueued)
  }

  const watcher = fsWatch(srcDir, { recursive: true }, (_eventType, filename) => {
    if (!isWatchedSourceFile(filename)) return

    if (rebuildTimeout) clearTimeout(rebuildTimeout)
    rebuildTimeout = setTimeout(runBuild, 100)
  })

  const cleanup = () => {
    console.log(`\n[watch] ${packageName}: stopping...`)
    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout)
      rebuildTimeout = null
    }
    watcher.close()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  await new Promise(() => {})
}

/**
 * Persistent watcher using Node.js fs.watch and an esbuild incremental context.
 * This is the legacy behavior for developers who prefer faster package rebuilds
 * and can afford the idle memory cost.
 *
 * The `getCtx` callback returns the *current* esbuild context — important
 * because adding new source files recreates the context, and we must call
 * `rebuild()` on the latest one. `refreshEntries` re-globs the entry-point
 * list before each rebuild and recreates the context if files were added or
 * removed; this is what makes brand-new modules show up in `dist/` without
 * a manual `yarn build`.
 */
async function watchWithPersistentContext(getCtx, packageDir, packageName, refreshEntries) {
  const srcDir = join(packageDir, 'src')
  let rebuildTimeout = null
  let isRebuilding = false

  const triggerRebuild = async () => {
    if (isRebuilding) return
    isRebuilding = true
    try {
      if (refreshEntries) await refreshEntries()
      console.log(`[watch] ${packageName}: rebuilding...`)
      await getCtx().rebuild()
      console.log(`[watch] ${packageName}: rebuild complete`)
    } catch (error) {
      console.error(`[watch] ${packageName}: rebuild failed:`, error.message)
    } finally {
      isRebuilding = false
    }
  }

  const onFileChange = (_eventType, filename) => {
    if (!isWatchedSourceFile(filename)) return

    if (rebuildTimeout) clearTimeout(rebuildTimeout)
    rebuildTimeout = setTimeout(triggerRebuild, 100)
  }

  // Windows supports recursive fs.watch natively
  fsWatch(srcDir, { recursive: true }, onFileChange)

  // Keep the process alive
  await new Promise(() => {})
}

function isWatchedSourceFile(filename) {
  if (!filename) return false
  if (!filename.endsWith('.ts') && !filename.endsWith('.tsx')) return false
  if (filename.includes('__tests__') || filename.includes('.test.')) return false
  return true
}
