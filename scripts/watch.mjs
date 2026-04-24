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

  const entryPoints = await glob('src/**/*.{ts,tsx}', {
    cwd: packageDir,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    absolute: true,
  })

  if (entryPoints.length === 0) {
    console.log(`[watch] ${packageName}: no source files found, skipping`)
    return
  }

  const ctx = await esbuild.context({
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
  })

  console.log(`[watch] ${packageName}: watching for changes...`)

  if (useManualWatcher) {
    // On macOS and Windows, esbuild's ctx.watch() can trigger an initial rebuild whose
    // onEnd hook races with the dev server loading modules. Use a manual fs.watch so we
    // rebuild only after real source changes.
    await watchWithFsWatcher(ctx, packageDir, packageName)
  } else {
    // Keep esbuild's native watch mode on Linux.
    await ctx.watch()
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
 */
async function watchWithFsWatcher(ctx, packageDir, packageName) {
  const srcDir = join(packageDir, 'src')
  let rebuildTimeout = null
  let isRebuilding = false

  const triggerRebuild = async () => {
    if (isRebuilding) return
    isRebuilding = true
    try {
      console.log(`[watch] ${packageName}: rebuilding...`)
      await ctx.rebuild()
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
