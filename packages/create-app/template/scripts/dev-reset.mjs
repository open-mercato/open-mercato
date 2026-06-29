#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const targets = [
  path.join(appDir, '.mercato', 'next', 'dev'),
  path.join(appDir, '.next', 'cache', 'turbopack'),
  path.join(appDir, '.next', 'cache', 'webpack'),
]

let removed = 0
for (const target of targets) {
  if (!fs.existsSync(target)) continue
  fs.rmSync(target, { recursive: true, force: true })
  console.log(`🧹 [dev:reset] removed ${path.relative(appDir, target)}`)
  removed += 1
}

if (removed === 0) {
  console.log('🧹 [dev:reset] nothing to clean — dev build caches already absent')
}

console.log('')
console.log('✅ Next.js dev cache cleared.')
console.log('   Start `yarn dev` again to pick up fresh module output.')
