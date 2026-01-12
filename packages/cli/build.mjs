import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const entryPoints = await glob(join(__dirname, 'src/**/*.ts'), { ignore: ['**/__tests__/**', '**/*.test.ts'] })

// Plugin to add .js extension to relative imports
const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const outputFiles = await glob(join(__dirname, 'dist/**/*.js'))
      for (const file of outputFiles) {
        const fileDir = dirname(file)
        let content = readFileSync(file, 'utf-8')
        // Add .js to relative imports that don't have an extension
        content = content.replace(
          /from\s+["'](\.[^"']+)["']/g,
          (match, path) => {
            // Skip paths that already have an extension (including .ts for generated code templates)
            if (path.endsWith('.js') || path.endsWith('.json') || path.endsWith('.ts')) return match
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
            // Skip paths that already have an extension (including .ts for generated code templates)
            if (path.endsWith('.js') || path.endsWith('.json') || path.endsWith('.ts')) return match
            // Check if it's a directory with index.js
            const resolvedPath = join(fileDir, path)
            if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
              return `import("${path}/index.js")`
            }
            return `import("${path}.js")`
          }
        )
        writeFileSync(file, content)
      }
    })
  }
}

const outdir = join(__dirname, 'dist')

await esbuild.build({
  entryPoints,
  outdir,
  outbase: join(__dirname, 'src'),
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  bundle: false,
  plugins: [addJsExtension],
})

// Make bin.js executable with shebang
const binPath = join(__dirname, 'dist/bin.js')
const binContent = readFileSync(binPath, 'utf-8')
writeFileSync(binPath, '#!/usr/bin/env node\n' + binContent)
chmodSync(binPath, 0o755)

console.log('CLI built successfully')
