#!/usr/bin/env node
/**
 * Linux-only RSS profiler for the consolidated in-process generate watcher.
 *
 * Spawns `mercato generate watch --skip-initial --quiet` once, lets it idle
 * for a configurable warmup, then sums `VmRSS` from `/proc/<pid>/status`
 * across the watcher PID and all its descendants. Prints a one-line summary
 * suitable for paste-in measurements.
 *
 * Companion to `scripts/profile-dev-rss.mjs` shipped with PR #2102. Use this
 * one to confirm the standalone-watcher idle RSS baseline before/after
 * extracting the in-process helper.
 *
 * Usage:
 *   node scripts/profile-generate-watch-rss.mjs [--warmup-ms=8000]
 *
 * Exit codes:
 *   0 — measurement printed successfully
 *   1 — watcher exited before the warmup elapsed (logs printed to stderr)
 *   2 — not running on Linux (no /proc/<pid>/status)
 */

import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux') {
  console.error(`profile-generate-watch-rss: this script needs /proc/<pid>/status; current platform is ${process.platform}.`)
  process.exit(2)
}

function parseWarmupMs(argv) {
  const arg = argv.find((value) => value.startsWith('--warmup-ms='))
  if (!arg) return 8000
  const parsed = Number.parseInt(arg.split('=')[1] ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1000) {
    console.error('profile-generate-watch-rss: --warmup-ms must be a positive integer >= 1000.')
    process.exit(1)
  }
  return parsed
}

function readRss(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m)
    if (!match) return null
    return Number.parseInt(match[1], 10)
  } catch {
    return null
  }
}

function readChildren(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
    return text.trim().split(/\s+/).filter(Boolean).map((id) => Number.parseInt(id, 10))
  } catch {
    return []
  }
}

function walkPidTree(rootPid) {
  const seen = new Set()
  const stack = [rootPid]
  while (stack.length > 0) {
    const pid = stack.pop()
    if (seen.has(pid)) continue
    seen.add(pid)
    for (const child of readChildren(pid)) {
      stack.push(child)
    }
  }
  return Array.from(seen)
}

function findRepoRoot(startDir) {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'apps'))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  throw new Error('Could not locate repo root from ' + startDir)
}

async function main() {
  const warmupMs = parseWarmupMs(process.argv.slice(2))
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = findRepoRoot(here)
  const appDir = path.join(repoRoot, 'apps', 'mercato')
  const mercatoBin = path.join(repoRoot, 'packages', 'cli', 'bin', 'mercato')

  if (!existsSync(mercatoBin)) {
    console.error('profile-generate-watch-rss: mercato CLI binary not found. Run `yarn build:packages` first.')
    process.exit(1)
  }

  console.log(`profile-generate-watch-rss: spawning standalone watcher (warmup ${warmupMs} ms)...`)
  const child = spawn('node', [mercatoBin, 'generate', 'watch', '--skip-initial', '--quiet'], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OM_CLI_QUIET: '1', DOTENV_CONFIG_QUIET: 'true' },
  })

  let exited = false
  let exitCode = null
  let exitSignal = null
  child.on('exit', (code, signal) => {
    exited = true
    exitCode = code
    exitSignal = signal
  })

  await new Promise((resolve) => setTimeout(resolve, warmupMs))

  if (exited) {
    console.error(`profile-generate-watch-rss: watcher exited prematurely (code=${exitCode} signal=${exitSignal}).`)
    process.exit(1)
  }

  const pids = walkPidTree(child.pid)
  let total = 0
  const rows = []
  for (const pid of pids) {
    const rss = readRss(pid)
    if (rss == null) continue
    total += rss
    rows.push({ pid, rssKb: rss })
  }

  console.log('--- RSS walk (after warmup) ---')
  for (const row of rows) {
    console.log(`  PID ${row.pid}  RSS=${row.rssKb} KB`)
  }
  console.log(`TOTAL RSS: ${total} KB = ${(total / 1024).toFixed(1)} MB`)
  console.log('-------------------------------')
  console.log(`legacy standalone watcher (this script)  : ~${(total / 1024).toFixed(0)} MB`)
  console.log(`in-process watcher (folded into mercato server dev): 0 MB dedicated`)
  console.log(`net savings on yarn dev idle             : ~${(total / 1024).toFixed(0)} MB`)

  child.kill('SIGINT')
  await new Promise((resolve) => {
    if (exited) return resolve()
    child.once('exit', resolve)
    setTimeout(() => {
      if (!exited) child.kill('SIGKILL')
      resolve()
    }, 5000)
  })
}

main().catch((err) => {
  console.error('profile-generate-watch-rss failed:', err)
  process.exit(1)
})
