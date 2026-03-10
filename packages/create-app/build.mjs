import * as esbuild from 'esbuild'
import { chmodSync, cpSync, existsSync, mkdirSync } from 'fs'

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

console.log('Build complete: dist/index.js')
