import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, basename } from 'node:path'

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
        const outputFiles = await glob(join(packageDir, 'dist/**/*.js'))
        for (const file of outputFiles) {
          const fileDir = dirname(file)
          let content = readFileSync(file, 'utf-8')
          // Add .js to relative imports that don't have an extension
          content = content.replace(
            /from\s+["'](\.[^"']+)["']/g,
            (match, path) => {
              if (path.endsWith('.js') || path.endsWith('.json')) return match
              // Check if it's a directory with index.js
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
              // Check if it's a directory with index.js
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
              // Check if it's a directory with index.js
              const resolvedPath = join(fileDir, path)
              if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
                return `import "${path}/index.js";`
              }
              return `import "${path}.js";`
            }
          )
          writeFileSync(file, content)
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

  const entryPoints = await glob(join(packageDir, 'src/**/*.{ts,tsx}'), {
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx']
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

  // Skip initial build - assume build:packages already ran
  // This avoids race conditions where the app starts before watch completes
  console.log(`[watch] ${packageName}: watching for changes...`)

  await ctx.watch()

  // Handle graceful shutdown
  const cleanup = async () => {
    console.log(`\n[watch] ${packageName}: stopping...`)
    await ctx.dispose()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}
