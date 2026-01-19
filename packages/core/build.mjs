import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const entryPoints = await glob(join(__dirname, 'src/**/*.{ts,tsx}'), {
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx']
})

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

// Function to copy JSON files
async function copyJsonFiles() {
  const jsonFiles = await glob(join(__dirname, 'src/**/*.json'), {
    ignore: ['**/node_modules/**', '**/i18n/**'] // i18n files are handled differently
  })
  for (const jsonFile of jsonFiles) {
    const relativePath = relative(join(__dirname, 'src'), jsonFile)
    const destPath = join(outdir, relativePath)
    mkdirSync(dirname(destPath), { recursive: true })
    copyFileSync(jsonFile, destPath)
  }
}

// Plugin to copy JSON files after build
const copyJsonPlugin = {
  name: 'copy-json',
  setup(build) {
    build.onEnd(async () => {
      await copyJsonFiles()
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
  jsx: 'automatic',
  plugins: [addJsExtension, copyJsonPlugin],
})

await ctx.rebuild()
console.log('core built successfully')

if (isWatchMode) {
  await ctx.watch()

  // Also watch JSON files separately using chokidar if available
  try {
    const chokidar = await import('chokidar')
    const jsonWatcher = chokidar.watch(join(__dirname, 'src/**/*.json'), {
      ignored: ['**/node_modules/**', '**/i18n/**'],
      persistent: true,
    })
    jsonWatcher.on('change', async (path) => {
      console.log(`[core] JSON file changed: ${relative(__dirname, path)}`)
      await copyJsonFiles()
    })
    jsonWatcher.on('add', async (path) => {
      console.log(`[core] JSON file added: ${relative(__dirname, path)}`)
      await copyJsonFiles()
    })
  } catch {
    // chokidar not available, JSON files will only be copied on TS changes
  }

  console.log('[core] Watching for changes...')
} else {
  await ctx.dispose()
}
