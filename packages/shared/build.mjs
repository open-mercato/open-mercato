import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Read the package version at build time for injection
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))
const packageVersion = packageJson.version

// Plugin to inject version at build time (replaces version.ts content)
const injectVersion = {
  name: 'inject-version',
  setup(build) {
    build.onLoad({ filter: /lib\/version\.ts$/ }, async () => {
      return {
        contents: `// Build-time generated version
export const APP_VERSION = '${packageVersion}'
export const appVersion = APP_VERSION
`,
        loader: 'ts'
      }
    })
  }
}

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
  plugins: [injectVersion, addJsExtension],
})

console.log('shared built successfully')
