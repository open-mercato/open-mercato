import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const entryPoints = await glob('src/**/*.{ts,tsx}', {
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx']
})

// Plugin to add .js extension to relative imports
const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const outputFiles = await glob('dist/**/*.js')
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
        // Only write if content actually changed to avoid race conditions with HMR
        if (content !== originalContent) {
          writeFileSync(file, content)
        }
      }
    })
  }
}

const isWatchMode = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints,
  outdir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  jsx: 'automatic',
  plugins: [addJsExtension],
})

await ctx.rebuild()
console.log('onboarding built successfully')

if (isWatchMode) {
  await ctx.watch()
  console.log('[onboarding] Watching for changes...')
} else {
  await ctx.dispose()
}
