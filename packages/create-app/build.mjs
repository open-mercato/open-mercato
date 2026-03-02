import * as esbuild from 'esbuild'
import { writeFileSync, readFileSync, chmodSync, cpSync, rmSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
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

chmodSync('dist/index.js', 0o755)

const repoRoot = join(__dirname, '..', '..')
const aiSrc = join(repoRoot, '.ai')
const aiDest = join(__dirname, 'dist', 'ai')

if (existsSync(aiDest)) {
  rmSync(aiDest, { recursive: true })
}

if (existsSync(aiSrc)) {
  cpSync(join(aiSrc, 'skills'), join(aiDest, 'skills'), { recursive: true })
  cpSync(join(aiSrc, 'qa', 'AGENTS.md'), join(aiDest, 'qa', 'AGENTS.md'))
  mkdirSync(join(aiDest, 'qa', 'scenarios'), { recursive: true })

  cpSync(join(aiSrc, 'specs', 'AGENTS.md'), join(aiDest, 'specs', 'AGENTS.md'))
  mkdirSync(join(aiDest, 'specs', 'enterprise'), { recursive: true })

  writeFileSync(join(aiDest, 'lessons.md'), '# Lessons Learned\n\nRecord debugging insights, recurring fixes, and patterns discovered during development.\n')

  console.log('Bundled .ai/ directory into dist/ai/')
} else {
  console.warn('Warning: .ai/ directory not found at repo root, skipping ai bundle')
}

console.log('Build complete: dist/index.js')
