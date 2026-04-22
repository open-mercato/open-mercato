import * as esbuild from 'esbuild'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join, basename } from 'path'

const shebang = '#!/usr/bin/env node\n'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outdir: 'dist',
  packages: 'external',
  banner: {
    js: shebang,
  },
})

// Make the output executable
chmodSync('dist/index.js', 0o755)

// Copy agentic source content to dist/ so generators can read it at runtime
if (existsSync('agentic')) {
  cpSync('agentic', 'dist/agentic', { recursive: true })
  console.log('Copied agentic/ → dist/agentic/')
}

// Auto-discover standalone guides from sibling packages
// Each package can provide packages/<name>/agentic/standalone-guide.md
const packagesDir = join('..') // packages/create-app/.. = packages/
const guidesDestDir = join('dist', 'agentic', 'guides')
mkdirSync(guidesDestDir, { recursive: true })

let guidesFound = 0
for (const pkg of readdirSync(packagesDir)) {
  const guideSource = join(packagesDir, pkg, 'agentic', 'standalone-guide.md')
  if (existsSync(guideSource)) {
    cpSync(guideSource, join(guidesDestDir, `${pkg}.md`))
    guidesFound++
  }
}
if (guidesFound > 0) {
  console.log(`Discovered ${guidesFound} standalone guides → dist/agentic/guides/`)
}

console.log('Build complete: dist/index.js')
