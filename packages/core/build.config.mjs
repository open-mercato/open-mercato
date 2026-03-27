/**
 * Core package build configuration.
 * Consumed by both build.mjs (one-shot) and scripts/watch-all.mjs (unified watcher).
 *
 * Special behaviors:
 * - #generated/* path resolution in .js extension plugin
 * - JSON file copying (excluding i18n)
 * - Secondary build for generated/ → dist/generated/
 */

import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const toImportPath = (p) => p.replace(/\\/g, '/')

function resolveGeneratedPath(distDir, importPath) {
  if (importPath === 'entity-fields-registry') {
    return join(distDir, 'generated-shims', 'entity-fields-registry.js')
  } else if (importPath.startsWith('entities/')) {
    return join(distDir, 'generated', importPath, 'index.js')
  } else {
    return join(distDir, 'generated', importPath + '.js')
  }
}

function createCoreJsExtensionPlugin(packageDir, { incremental = false } = {}) {
  let buildStartedAt = null
  let isFirstBuild = true
  const forceFullRewrite = process.env.OM_DEV_FORCE_FULL_JS_REWRITE === 'true'
  const skewWindowMs = 100

  return {
    name: 'add-js-extension',
    setup(build) {
      if (incremental) {
        build.onStart(() => { buildStartedAt = Date.now() })
      }

      build.onEnd(async (result) => {
        if (result.errors.length > 0) return

        const outputFiles = await glob('dist/**/*.js', { cwd: packageDir, absolute: true })
        const distDir = join(packageDir, 'dist')

        const shouldProcess = (file) => {
          if (!incremental || isFirstBuild || forceFullRewrite) return true
          try {
            const stat = statSync(file)
            return stat.mtimeMs >= (buildStartedAt - skewWindowMs)
          } catch { return false }
        }

        for (const file of outputFiles) {
          if (!shouldProcess(file)) continue

          const fileDir = dirname(file)
          let content = readFileSync(file, 'utf-8')

          // Resolve #generated/* static imports
          content = content.replace(
            /from\s+["']#generated\/([^"']+)["']/g,
            (match, importPath) => {
              const targetPath = resolveGeneratedPath(distDir, importPath)
              let relativePath = toImportPath(relative(fileDir, targetPath))
              if (!relativePath.startsWith('.')) relativePath = './' + relativePath
              return `from "${relativePath}"`
            }
          )

          // Resolve #generated/* dynamic imports
          content = content.replace(
            /import\s*\(\s*["']#generated\/([^"']+)["']\s*\)/g,
            (match, importPath) => {
              const targetPath = resolveGeneratedPath(distDir, importPath)
              let relativePath = toImportPath(relative(fileDir, targetPath))
              if (!relativePath.startsWith('.')) relativePath = './' + relativePath
              return `import("${relativePath}")`
            }
          )

          // Standard .js extension rewrites
          content = content.replace(
            /from\s+["'](\.[^"']+)["']/g,
            (match, path) => {
              if (path.endsWith('.js') || path.endsWith('.json')) return match
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
              if (path.endsWith('.js') || path.endsWith('.json')) return match
              const resolvedPath = join(fileDir, path)
              if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
                return `import "${path}/index.js";`
              }
              return `import "${path}.js";`
            }
          )

          writeFileSync(file, content)
        }

        if (incremental) isFirstBuild = false
      })
    },
  }
}

export async function getBuildOptions(packageDir, { target = 'node24', incremental = false } = {}) {
  const entryPoints = await glob('src/**/*.{ts,tsx}', {
    cwd: packageDir,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    absolute: true,
  })

  return {
    entryPoints,
    outdir: join(packageDir, 'dist'),
    outbase: join(packageDir, 'src'),
    format: 'esm',
    platform: 'node',
    target,
    sourcemap: true,
    jsx: 'automatic',
    plugins: [createCoreJsExtensionPlugin(packageDir, { incremental })],
    logLevel: 'warning',
  }
}

export async function postBuild(packageDir) {
  const outdir = join(packageDir, 'dist')

  // Copy JSON files (excluding i18n)
  const jsonFiles = await glob('src/**/*.json', {
    cwd: packageDir,
    ignore: ['**/node_modules/**', '**/i18n/**'],
    absolute: true,
  })
  for (const jsonFile of jsonFiles) {
    const relativePath = relative(join(packageDir, 'src'), jsonFile)
    const destPath = join(outdir, relativePath)
    mkdirSync(dirname(destPath), { recursive: true })
    copyFileSync(jsonFile, destPath)
  }
}

export async function getExtraContexts(packageDir, esbuild, { target = 'node24', incremental = false } = {}) {
  const generatedEntryPoints = await glob('generated/**/*.{ts,tsx}', {
    cwd: packageDir,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    absolute: true,
  })

  if (generatedEntryPoints.length === 0) return []

  return [{
    label: 'core:generated',
    options: {
      entryPoints: generatedEntryPoints,
      outdir: join(packageDir, 'dist/generated'),
      outbase: join(packageDir, 'generated'),
      format: 'esm',
      platform: 'node',
      target,
      sourcemap: true,
      plugins: [createCoreJsExtensionPlugin(packageDir, { incremental })],
      logLevel: 'warning',
    },
  }]
}
