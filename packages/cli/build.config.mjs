/**
 * CLI package build configuration.
 * Special behaviors: shebang injection, agentic/ copy from create-app, .ts extension skip.
 */

import { glob } from 'glob'
import { readFileSync, writeFileSync, chmodSync, existsSync, cpSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

function createCliJsExtensionPlugin(packageDir, { incremental = false } = {}) {
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
          content = content.replace(
            /from\s+["'](\.[^"']+)["']/g,
            (match, path) => {
              if (path.endsWith('.js') || path.endsWith('.json') || path.endsWith('.ts')) return match
              if (path.includes('${')) return match
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
              const resolvedPath = join(fileDir, path)
              if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
                return `import("${path}/index.js")`
              }
              return `import("${path}.js")`
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
  const entryPoints = await glob('src/**/*.ts', {
    cwd: packageDir,
    ignore: ['**/__tests__/**', '**/*.test.ts'],
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
    bundle: false,
    write: true,
    plugins: [createCliJsExtensionPlugin(packageDir, { incremental })],
    logLevel: 'warning',
  }
}

export async function postBuild(packageDir) {
  const binPath = join(packageDir, 'dist/bin.js')
  if (existsSync(binPath)) {
    const binContent = readFileSync(binPath, 'utf-8')
    if (!binContent.startsWith('#!')) {
      writeFileSync(binPath, '#!/usr/bin/env node\n' + binContent)
      chmodSync(binPath, 0o755)
    }
  }

  const agenticSrc = join(packageDir, '..', 'create-app', 'agentic')
  if (existsSync(agenticSrc)) {
    cpSync(agenticSrc, join(packageDir, 'dist', 'agentic'), { recursive: true })
  }
}
