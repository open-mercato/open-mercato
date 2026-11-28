#!/usr/bin/env node
/**
 * Enforce the @open-mercato/storefront-ui budget from
 * `.ai/specs/2026-08-14-storefront-app.md` §3.2 (reading documented in
 * `.ai/specs/2026-10-30-storefront-ui-design-system.md` §5):
 *
 *   - the package's own code, bundled from src/index.ts with its fixed runtime
 *     dependencies and React marked external, minified and gzipped, stays ≤ 45 kB;
 *   - the bundle imports nothing outside the fixed dependency list.
 *
 * Dependency sizes are printed for information only: Radix and the class helpers
 * are shared with the storefront app bundle, which the storefront spec budgets separately.
 */
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = path.join(ROOT, 'packages/storefront-ui')
const BUDGET_BYTES = 45 * 1024

const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'))
const fixedDependencies = Object.keys(manifest.dependencies ?? {})
const external = [...fixedDependencies, 'react', 'react-dom', 'react/jsx-runtime']

const result = await esbuild.build({
  entryPoints: [path.join(PACKAGE, 'src/index.ts')],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  metafile: true,
  external,
  logLevel: 'silent',
})

const output = result.outputFiles[0]
const gzipBytes = zlib.gzipSync(output.contents).byteLength
const imported = new Set()
for (const file of Object.values(result.metafile.outputs)) {
  for (const entry of file.imports ?? []) {
    if (entry.external) imported.add(entry.path)
  }
}
const unexpected = [...imported].filter((specifier) => {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
  return !external.includes(name) && name !== 'react'
})

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
console.log(`storefront-ui own code: ${kb(output.contents.byteLength)} minified, ${kb(gzipBytes)} gzipped (budget ${kb(BUDGET_BYTES)})`)
console.log(`external imports: ${[...imported].sort((left, right) => left.localeCompare(right)).join(', ')}`)

let failed = false
if (gzipBytes > BUDGET_BYTES) {
  console.error(`Budget exceeded by ${kb(gzipBytes - BUDGET_BYTES)}.`)
  failed = true
}
if (unexpected.length > 0) {
  console.error(`Imports outside the fixed dependency list: ${unexpected.join(', ')}`)
  failed = true
}
process.exit(failed ? 1 : 0)
