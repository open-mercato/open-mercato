#!/usr/bin/env node
// Central entry for every way of starting Open Mercato:
//   npx @open-mercato/starter [command]   — anywhere; clones first if needed
//   yarn om [command]                     — inside a clone
//   packages/starter/platform/start.*     — pre-Node bootstrap wrappers
//
// This bin only solves "where is the repo?" (cloning when necessary) and
// version skew (a clone's own vendored starter wins over the npx copy), then
// defers every real decision to src/cli.mjs. Node stdlib only — it must run
// on a fresh clone before any yarn install.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveRepoRoot } from '../src/compose.mjs'

const REPO_URL = 'https://github.com/open-mercato/open-mercato.git'

function extractBootstrapFlag(args, flag) {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) return null
  const value = args[index + 1]
  args.splice(index, 2)
  return value
}

async function ensureRepo(args) {
  const found = resolveRepoRoot()
  if (found) return found

  const dir = extractBootstrapFlag(args, '--dir') ?? path.join(process.cwd(), 'open-mercato')
  const branch = extractBootstrapFlag(args, '--branch') ?? 'main'
  if (fs.existsSync(path.join(dir, '.git'))) {
    return resolveRepoRoot(dir)
  }
  const git = spawnSync('git', ['--version'], { stdio: 'ignore' })
  if (git.error || git.status !== 0) {
    console.error('❌ No Open Mercato checkout found here and git is not installed.')
    console.error('   Install git, or clone manually and re-run this command inside the clone:')
    console.error(`     git clone ${REPO_URL}`)
    process.exit(2)
  }
  console.log(`No checkout found — cloning open-mercato (${branch}) into ${dir} ...`)
  const clone = spawnSync('git', ['clone', '--branch', branch, REPO_URL, dir], { stdio: 'inherit' })
  if (clone.status !== 0) {
    console.error('❌ git clone failed. Behind a corporate proxy? Configure git first (ask IT for the proxy address):')
    console.error('     git config --global http.proxy http://proxy.example.com:8080')
    console.error('   On Windows also:  git config --global http.sslBackend schannel')
    process.exit(clone.status ?? 1)
  }
  return resolveRepoRoot(dir)
}

async function main() {
  const args = process.argv.slice(2)
  const repoRoot = await ensureRepo(args)
  if (!repoRoot) {
    console.error('❌ Could not locate an Open Mercato repo root.')
    process.exit(2)
  }
  process.chdir(repoRoot)

  // Prefer the repo's own vendored starter (gradlew pattern): the clone knows
  // which starter version matches its compose files and runtime contract.
  const selfDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const vendored = path.join(repoRoot, 'packages', 'starter', 'bin', 'om-start.mjs')
  if (fs.existsSync(vendored) && path.resolve(selfDir, 'bin', 'om-start.mjs') !== path.resolve(vendored)) {
    const child = spawn(process.execPath, [vendored, ...args], { stdio: 'inherit', cwd: repoRoot })
    child.on('close', (code) => process.exit(code ?? 0))
    return
  }

  process.argv = [process.argv[0], process.argv[1], ...args]
  await import('../src/cli.mjs')
}

await main()
