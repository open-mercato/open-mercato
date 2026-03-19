import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync, watch as fsWatch } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { platform } from 'node:os'

const isWindows = platform() === 'win32'

/**
 * Add .js extensions to relative imports in a compiled file
 * @param {string} filePath - Path to the compiled .js file
 */
function addJsExtensionsToFile(filePath) {
  const fileDir = dirname(filePath)
  let content = readFileSync(filePath, 'utf-8')
  let modified = false

  // Add .js to relative imports that don't have an extension
  content = content.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (match, path) => {
      if (path.endsWith('.js') || path.endsWith('.json')) return match
      modified = true
      const resolvedPath = join(fileDir, path)
      if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
        return `from "${path}/index.js"`
      }
      return `from "${path}.js"`
    }
  )

  content = content.replace(
    /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
    (match, path) => {
      if (path.endsWith('.js') || path.endsWith('.json')) return match
      modified = true
      const resolvedPath = join(fileDir, path)
      if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
        return `import("${path}/index.js")`
      }
      return `import("${path}.js")`
    }
  )

  // Handle side-effect imports: import "./path" (no from clause)
  content = content.replace(
    /import\s+["'](\.[^"']+)["'];/g,
    (match, path) => {
      if (path.endsWith('.js') || path.endsWith('.json')) return match
      modified = true
      const resolvedPath = join(fileDir, path)
      if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
        return `import "${path}/index.js";`
      }
      return `import "${path}.js";`
    }
  )

  if (modified) {
    writeFileSync(filePath, content)
  }
}

/**
 * Creates the add-js-extension plugin for a given package directory
 * This plugin adds .js extensions to relative imports after compilation
 */
function createAddJsExtensionPlugin(packageDir) {
  return {
    name: 'add-js-extension',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) return
        const outputFiles = await glob('dist/**/*.js', { cwd: packageDir, absolute: true })
        for (const file of outputFiles) {
          addJsExtensionsToFile(file)
        }
      })
    }
  }
}

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
    entryPoints,
    outdir: join(packageDir, 'dist'),
    outbase: join(packageDir, 'src'),
    format: 'esm',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    jsx: 'automatic',
    plugins: [createAddJsExtensionPlugin(packageDir)],
    logLevel: 'warning',
  })

  console.log(`[watch] ${packageName}: watching for changes...`)

  if (isWindows) {
    // On Windows, esbuild's ctx.watch() triggers an initial rebuild whose onEnd hook
    // (adding .js extensions) races with the dev server loading modules. Use a manual
    // fs.watch so that we only rebuild when source files actually change.
    await watchWithFsWatcher(ctx, packageDir, packageName)
  } else {
    // On Linux/macOS, ctx.watch() works reliably — the initial rebuild completes
    // before the dev server tries to load modules.
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
 * Windows-specific watcher using Node.js fs.watch instead of esbuild's built-in watch.
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
