import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const entryPoints = await glob('src/**/*.{ts,tsx}', {
  cwd: __dirname,
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
  absolute: true,
})

if (entryPoints.length === 0) {
  console.error('No entry points found!')
  process.exit(1)
}

console.log(`Found ${entryPoints.length} entry points`)

function normalizeImportPath(fileDir, importPath) {
  if (
    importPath.endsWith('.js') ||
    importPath.endsWith('.json') ||
    importPath.endsWith('.mjs') ||
    importPath.endsWith('.cjs')
  ) {
    return importPath
  }

  if (importPath.startsWith('.')) {
    const resolvedPath = join(fileDir, importPath)
    if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
      return `${importPath}/index.js`
    }
    return `${importPath}.js`
  }

  if (importPath.startsWith('next/')) {
    return `${importPath}.js`
  }

  return importPath
}

// Plugin to add .js extension to relative imports
const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const outputFiles = await glob('dist/**/*.js', { cwd: __dirname, absolute: true })
      for (const file of outputFiles) {
        const fileDir = dirname(file)
        let content = readFileSync(file, 'utf-8')
        // Add .js to relative and next/* imports that don't have an extension
        content = content.replace(
          /from\s+["']((?:next\/|\.)[^"']+)["']/g,
          (match, importPath) => {
            const normalized = normalizeImportPath(fileDir, importPath)
            if (normalized === importPath) return match
            return `from "${normalized}"`
          }
        )
        content = content.replace(
          /import\s*\(\s*["']((?:next\/|\.)[^"']+)["']\s*\)/g,
          (match, importPath) => {
            const normalized = normalizeImportPath(fileDir, importPath)
            if (normalized === importPath) return match
            return `import("${normalized}")`
          }
        )
        writeFileSync(file, content)
      }
    })
  }
}

await esbuild.build({
  entryPoints,
  outdir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  jsx: 'automatic',
  plugins: [addJsExtension],
})

console.log('ui built successfully')
