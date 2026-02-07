import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const toGlobPath = (p) => p.replace(/\\/g, '/')

const srcEntryPoints = await glob(toGlobPath(join(__dirname, 'src/**/*.{ts,tsx}')), {
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx']
})

const generatedEntryPoints = await glob(toGlobPath(join(__dirname, 'generated/**/*.{ts,tsx}')), {
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx']
})

const entryPoints = srcEntryPoints

const toImportPath = (p) => p.replace(/\\/g, '/')

// Plugin to add .js extension to relative imports and resolve #generated/* imports
const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const outputFiles = await glob(toGlobPath(join(__dirname, 'dist/**/*.js')))
      const distDir = join(__dirname, 'dist')
      for (const file of outputFiles) {
        const fileDir = dirname(file)
        let content = readFileSync(file, 'utf-8')

        // Helper to resolve #generated/* paths
        const resolveGeneratedPath = (importPath) => {
          if (importPath === 'entity-fields-registry') {
            // Special case: entity-fields-registry is in generated-shims
            return join(distDir, 'generated-shims', 'entity-fields-registry.js')
          } else if (importPath.startsWith('entities/')) {
            // Entity imports: #generated/entities/<name> → dist/generated/entities/<name>/index.js
            return join(distDir, 'generated', importPath, 'index.js')
          } else {
            // Other generated files: #generated/<name> → dist/generated/<name>.js
            return join(distDir, 'generated', importPath + '.js')
          }
        }

        // Resolve #generated/* static imports to relative paths
        content = content.replace(
          /from\s+["']#generated\/([^"']+)["']/g,
          (match, importPath) => {
            const targetPath = resolveGeneratedPath(importPath)
            let relativePath = toImportPath(relative(fileDir, targetPath))
            if (!relativePath.startsWith('.')) {
              relativePath = './' + relativePath
            }
            return `from "${relativePath}"`
          }
        )

        // Resolve #generated/* dynamic imports to relative paths
        content = content.replace(
          /import\s*\(\s*["']#generated\/([^"']+)["']\s*\)/g,
          (match, importPath) => {
            const targetPath = resolveGeneratedPath(importPath)
            let relativePath = toImportPath(relative(fileDir, targetPath))
            if (!relativePath.startsWith('.')) {
              relativePath = './' + relativePath
            }
            return `import("${relativePath}")`
          }
        )

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
  jsx: 'automatic',
  plugins: [addJsExtension],
})

// Copy JSON files from src to dist (esbuild doesn't handle non-entry JSON files)
const jsonFiles = await glob(toGlobPath(join(__dirname, 'src/**/*.json')), {
  ignore: ['**/node_modules/**', '**/i18n/**'] // i18n files are handled differently
})
for (const jsonFile of jsonFiles) {
  const relativePath = relative(join(__dirname, 'src'), jsonFile)
  const destPath = join(outdir, relativePath)
  mkdirSync(dirname(destPath), { recursive: true })
  copyFileSync(jsonFile, destPath)
}

// Build generated files to dist/generated
if (generatedEntryPoints.length > 0) {
  await esbuild.build({
    entryPoints: generatedEntryPoints,
    outdir: join(__dirname, 'dist/generated'),
    outbase: join(__dirname, 'generated'),
    format: 'esm',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    plugins: [addJsExtension],
  })
}

console.log('core built successfully')
