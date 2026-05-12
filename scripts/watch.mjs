import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { watch as fsWatch } from 'node:fs'
import { basename, join } from 'node:path'
import { platform } from 'node:os'
import { createAtomicWritePlugin } from './lib/add-js-extension.mjs'

const currentPlatform = platform()
const useManualWatcher = currentPlatform === 'win32' || currentPlatform === 'darwin'

/**
 * Start watching a package for changes and incrementally rebuild
 * @param {string} packageDir - Absolute path to the package directory
 */
export async function watch(packageDir) {
  const packageName = basename(packageDir)

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

  const buildContext = async (points) =>
    esbuild.context({
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

  let ctx = await buildContext(entryPoints)
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
    ctx = await buildContext(entryPoints)
    return true
  }

  console.log(`[watch] ${packageName}: watching for changes...`)

  if (useManualWatcher) {
    // On macOS and Windows, esbuild's ctx.watch() can trigger an initial rebuild whose
    // onEnd hook races with the dev server loading modules. Use a manual fs.watch so we
    // rebuild only after real source changes.
    await watchWithFsWatcher(() => ctx, packageDir, packageName, refreshEntryPointsIfChanged)
  } else {
    // Linux uses esbuild's native watch mode for incremental rebuilds, but
    // we still need our own fs.watch to detect file additions/removals so
    // we can recreate the context with the refreshed entry-point list.
    await ctx.watch()
    fsWatch(join(packageDir, 'src'), { recursive: true }, async (_eventType, filename) => {
      if (!filename) return
      if (!filename.endsWith('.ts') && !filename.endsWith('.tsx')) return
      if (filename.includes('__tests__') || filename.includes('.test.')) return
      try {
        const recreated = await refreshEntryPointsIfChanged()
        if (recreated) {
          await ctx.watch()
        }
      } catch (error) {
        console.error(
          `[watch] ${packageName}: failed to refresh entry points:`,
          error?.message ?? error,
        )
      }
    })
  }

  // Handle graceful shutdown
  const cleanup = async () => {
    console.log(`\n[watch] ${packageName}: stopping...`)
    await ctx.dispose()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

/**
 * Manual watcher using Node.js fs.watch instead of esbuild's built-in watch.
 * Avoids the initial-rebuild race condition where the dev server loads modules before
 * the onEnd hook has finished adding .js extensions.
 *
 * The `getCtx` callback returns the *current* esbuild context — important
 * because adding new source files recreates the context, and we must call
 * `rebuild()` on the latest one. `refreshEntries` re-globs the entry-point
 * list before each rebuild and recreates the context if files were added or
 * removed; this is what makes brand-new modules show up in `dist/` without
 * a manual `yarn build`.
 */
async function watchWithFsWatcher(getCtx, packageDir, packageName, refreshEntries) {
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
    if (!filename) return
    if (!filename.endsWith('.ts') && !filename.endsWith('.tsx')) return
    if (filename.includes('__tests__') || filename.includes('.test.')) return

    if (rebuildTimeout) clearTimeout(rebuildTimeout)
    rebuildTimeout = setTimeout(triggerRebuild, 100)
  }

  // Windows supports recursive fs.watch natively
  fsWatch(srcDir, { recursive: true }, onFileChange)

  // Keep the process alive
  await new Promise(() => {})
}
