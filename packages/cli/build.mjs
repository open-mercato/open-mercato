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
        const originalContent = content
        // Add .js to relative imports that don't have an extension
        content = content.replace(
          /from\s+["'](\.[^"']+)["']/g,
          (match, path) => {
            // Skip paths that already have an extension (including .ts for generated code templates)
            if (path.endsWith('.js') || path.endsWith('.json') || path.endsWith('.ts')) return match
            // Skip paths containing template literal placeholders (code generation templates)
            if (path.includes('${')) return match
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
            // Skip paths containing template literal placeholders (code generation templates)
            if (path.includes('${')) return match
            // Check if it's a directory with index.js
            const resolvedPath = join(fileDir, path)
            if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
              return `import("${path}/index.js")`
            }
            return `import("${path}.js")`
          }
        )
        // Only write if content actually changed to avoid race conditions with HMR
        if (content !== originalContent) {
          writeFileSync(file, content)
        }
      }
    })
  }
}

const outdir = join(__dirname, 'dist')
const isWatchMode = process.argv.includes('--watch')

// Function to add shebang to bin.js
function addShebangToBin() {
  const binPath = join(__dirname, 'dist/bin.js')
  if (existsSync(binPath)) {
    const binContent = readFileSync(binPath, 'utf-8')
    if (!binContent.startsWith('#!/usr/bin/env node')) {
      writeFileSync(binPath, '#!/usr/bin/env node\n' + binContent)
      chmodSync(binPath, 0o755)
    }
  }
}

// Plugin to add shebang after build
const addShebangPlugin = {
  name: 'add-shebang',
  setup(build) {
    build.onEnd(() => {
      addShebangToBin()
    })
  }
}

const ctx = await esbuild.context({
  entryPoints,
  outdir,
  outbase: join(__dirname, 'src'),
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  bundle: false,
  plugins: [addJsExtension, addShebangPlugin],
})

await ctx.rebuild()
console.log('CLI built successfully')

if (isWatchMode) {
  await ctx.watch()
  console.log('[cli] Watching for changes...')
} else {
  await ctx.dispose()
}
