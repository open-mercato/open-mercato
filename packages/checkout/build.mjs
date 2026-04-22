import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

rmSync(join(__dirname, 'dist'), { recursive: true, force: true })

const entryPoints = await glob('src/**/*.{ts,tsx}', {
  cwd: __dirname,
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
  absolute: true,
})

if (entryPoints.length === 0) {
  console.error('No entry points found!')
  process.exit(1)
}

const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const outputFiles = await glob('dist/**/*.js', { cwd: __dirname, absolute: true })
      for (const file of outputFiles) {
        const fileDir = dirname(file)
        let content = readFileSync(file, 'utf-8')
        content = content.replace(/from\s+["'](\.[^"']+)["']/g, (match, path) => {
          if (path.endsWith('.js') || path.endsWith('.json')) return match
          const resolvedPath = join(fileDir, path)
          if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
            return `from "${path}/index.js"`
          }
          return `from "${path}.js"`
        })
        content = content.replace(/import\s*\(\s*["'](\.[^"']+)["']\s*\)/g, (match, path) => {
          if (path.endsWith('.js') || path.endsWith('.json')) return match
          const resolvedPath = join(fileDir, path)
          if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
            return `import("${path}/index.js")`
          }
          return `import("${path}.js")`
        })
        content = content.replace(/import\s+["'](\.[^"']+)["'];/g, (match, path) => {
          if (path.endsWith('.js') || path.endsWith('.json')) return match
          const resolvedPath = join(fileDir, path)
          if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
            return `import "${path}/index.js";`
          }
          return `import "${path}.js";`
        })
        writeFileSync(file, content)
      }
    })
  },
}

const context = await esbuild.context({
  absWorkingDir: __dirname,
  entryPoints,
  outdir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  jsx: 'automatic',
  plugins: [addJsExtension],
})

if (watch) {
  await context.watch()
  console.log('checkout watching for changes')
} else {
  await context.rebuild()
  await context.dispose()
  console.log('checkout built successfully')
}
