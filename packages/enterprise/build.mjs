import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const entryPoints = await glob('src/**/*.{ts,tsx}', {
  cwd: __dirname,
  ignore: ['**/__tests__/**', '**/__integration__/**', '**/*.test.ts', '**/*.test.tsx'],
  absolute: true,
})

if (entryPoints.length === 0) {
  console.error('No entry points found!')
  process.exit(1)
}

console.log(`Found ${entryPoints.length} entry points`)

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

const outdir = join(__dirname, 'dist')

await esbuild.build({
  entryPoints,
  outdir,
  outbase: join(__dirname, 'src'),
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  jsx: 'automatic',
  plugins: [addJsExtension],
})

// Copy JSON files from src to dist (esbuild doesn't handle non-entry JSON files)
const jsonFiles = await glob('src/**/*.json', {
  cwd: __dirname,
  ignore: ['**/node_modules/**'],
  absolute: true,
})
for (const jsonFile of jsonFiles) {
  const relativePath = relative(join(__dirname, 'src'), jsonFile)
  const destPath = join(outdir, relativePath)
  mkdirSync(dirname(destPath), { recursive: true })
  copyFileSync(jsonFile, destPath)
}

console.log('enterprise package built successfully')
