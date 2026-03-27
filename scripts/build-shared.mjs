/**
 * Shared build utilities for the optimized dev pipeline.
 *
 * Provides:
 * - addJsExtensionsToFile: core .js extension rewrite function
 * - createAddJsExtensionPlugin: standard esbuild plugin (full scan)
 * - createIncrementalJsExtensionPlugin: mtime-based incremental rewrite (Phase 4)
 * - copyJsonFiles: copy non-entry JSON files from src → dist
 * - getDefaultBuildOptions: convention-based esbuild config
 * - loadBuildConfig: load package build.config.mjs or return defaults
 * - RUNTIME_PACKAGES: packages included in optimized dev (Phase 2)
 */

import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join, relative, basename } from 'node:path'

// Phase 2 — runtime package set (excludes create-app)
export const RUNTIME_PACKAGES = [
  'shared',
  'core',
  'ui',
  'cli',
  'cache',
  'queue',
  'events',
  'search',
  'scheduler',
  'content',
  'onboarding',
  'enterprise',
  'ai-assistant',
  'webhooks',
  'checkout',
  'gateway-stripe',
  'sync-akeneo',
]

/**
 * Add .js extensions to relative imports in a single compiled file.
 */
export function addJsExtensionsToFile(filePath) {
  const fileDir = dirname(filePath)
  let content = readFileSync(filePath, 'utf-8')
  let modified = false

  content = content.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (match, path) => {
      if (path.endsWith('.js') || path.endsWith('.json') || path.endsWith('.ts')) return match
      if (path.includes('${')) return match
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
      if (path.endsWith('.js') || path.endsWith('.json') || path.endsWith('.ts')) return match
      if (path.includes('${')) return match
      modified = true
      const resolvedPath = join(fileDir, path)
      if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
        return `import("${path}/index.js")`
      }
      return `import("${path}.js")`
    }
  )

  content = content.replace(
    /import\s+["'](\.[^"']+)["'];/g,
    (match, path) => {
      if (path.endsWith('.js') || path.endsWith('.json') || path.endsWith('.ts')) return match
      if (path.includes('${')) return match
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
 * Standard full-scan .js extension plugin (used by one-shot builds).
 */
export function createAddJsExtensionPlugin(packageDir) {
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
    },
  }
}

/**
 * Phase 4 — Incremental mtime-based .js extension plugin for watch mode.
 * Only processes files whose mtime is newer than buildStartedAt.
 * Falls back to full scan on first build or when OM_DEV_FORCE_FULL_JS_REWRITE is set.
 */
export function createIncrementalJsExtensionPlugin(packageDir) {
  let buildStartedAt = null
  let isFirstBuild = true
  const forceFullRewrite = process.env.OM_DEV_FORCE_FULL_JS_REWRITE === 'true'
  const skewWindowMs = 100

  return {
    name: 'add-js-extension-incremental',
    setup(build) {
      build.onStart(() => {
        buildStartedAt = Date.now()
      })

      build.onEnd(async (result) => {
        if (result.errors.length > 0) return

        const outputFiles = await glob('dist/**/*.js', { cwd: packageDir, absolute: true })

        if (isFirstBuild || forceFullRewrite) {
          for (const file of outputFiles) {
            addJsExtensionsToFile(file)
          }
          isFirstBuild = false
          return
        }

        const threshold = buildStartedAt - skewWindowMs
        let processed = 0
        for (const file of outputFiles) {
          try {
            const stat = statSync(file)
            if (stat.mtimeMs >= threshold) {
              addJsExtensionsToFile(file)
              processed++
            }
          } catch {
            // file may have been deleted between glob and stat
          }
        }

        if (processed > 0) {
          const pkgName = basename(packageDir)
          console.log(`  [rewrite] ${pkgName}: processed ${processed}/${outputFiles.length} files (incremental)`)
        }
      })
    },
  }
}

/**
 * Copy JSON files from src/ to dist/ (esbuild doesn't handle non-entry JSON).
 */
export async function copyJsonFiles(packageDir, { ignore = [] } = {}) {
  const jsonFiles = await glob('src/**/*.json', {
    cwd: packageDir,
    ignore: ['**/node_modules/**', ...ignore],
    absolute: true,
  })
  const outdir = join(packageDir, 'dist')
  for (const jsonFile of jsonFiles) {
    const relativePath = relative(join(packageDir, 'src'), jsonFile)
    const destPath = join(outdir, relativePath)
    mkdirSync(dirname(destPath), { recursive: true })
    copyFileSync(jsonFile, destPath)
  }
  return jsonFiles.length
}

/**
 * Get default esbuild build options for a package.
 */
export async function getDefaultBuildOptions(packageDir, { target = 'node24', incremental = false } = {}) {
  const entryPoints = await glob('src/**/*.{ts,tsx}', {
    cwd: packageDir,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    absolute: true,
  })

  const plugin = incremental
    ? createIncrementalJsExtensionPlugin(packageDir)
    : createAddJsExtensionPlugin(packageDir)

  return {
    entryPoints,
    outdir: join(packageDir, 'dist'),
    outbase: join(packageDir, 'src'),
    format: 'esm',
    platform: 'node',
    target,
    sourcemap: true,
    jsx: 'automatic',
    plugins: [plugin],
    logLevel: 'warning',
  }
}

/**
 * Load a package's build.config.mjs if it exists, or return default config.
 * build.config.mjs should export:
 *   getBuildOptions(packageDir, opts) → esbuild options
 *   postBuild?(packageDir) → async post-build steps
 *   getExtraContexts?(packageDir, opts) → additional esbuild contexts for watch
 */
export async function loadBuildConfig(packageDir, opts = {}) {
  const configPath = join(packageDir, 'build.config.mjs')
  if (existsSync(configPath)) {
    const config = await import(configPath)
    return config
  }
  return null
}

/**
 * Resolve the set of runtime package directories from the monorepo root.
 */
export function resolveRuntimePackageDirs(rootDir) {
  return RUNTIME_PACKAGES
    .map(name => join(rootDir, 'packages', name))
    .filter(dir => existsSync(dir))
}
