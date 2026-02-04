#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const sharedBuild = join(__dirname, '../../shared/scripts/build.mjs')

const result = spawnSync('node', [sharedBuild, 'cache'], {
  stdio: 'inherit',
  cwd: process.cwd()
})

process.exit(result.status || 0)
