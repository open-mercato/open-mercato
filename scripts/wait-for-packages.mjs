/**
 * Phase 9 — Manifest-based readiness waiter.
 * Replaces `sleep 3` in the optimized dev pipeline.
 *
 * Usage: node scripts/wait-for-packages.mjs [--session <id>] [--timeout <ms>]
 *
 * Exits 0 when all packages and generator are ready.
 * Exits 1 on timeout or failure.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const MANIFEST_PATH = join(ROOT_DIR, '.mercato', 'dev-watch', 'manifest.json')

const args = process.argv.slice(2)
const sessionIdx = args.indexOf('--session')
const timeoutIdx = args.indexOf('--timeout')
const expectedSession = sessionIdx !== -1 ? args[sessionIdx + 1] : null
const timeoutMs = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : 120_000
const heartbeatStaleMs = 10_000

function readManifest() {
  try {
    if (!existsSync(MANIFEST_PATH)) return null
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function checkReady() {
  const m = readManifest()
  if (!m) return { ready: false, reason: 'manifest not found' }

  if (expectedSession && m.sessionId !== expectedSession) {
    return { ready: false, reason: `waiting for session ${expectedSession}, found ${m.sessionId}` }
  }

  // Check heartbeat staleness
  const heartbeatAge = Date.now() - new Date(m.heartbeatAt).getTime()
  if (heartbeatAge > heartbeatStaleMs) {
    return { ready: false, reason: `heartbeat stale (${Math.round(heartbeatAge / 1000)}s old)`, fatal: true }
  }

  if (m.status === 'dead') {
    return { ready: false, reason: 'session is dead', fatal: true }
  }

  if (m.status === 'failed') {
    const failedPkgs = Object.entries(m.packages)
      .filter(([, p]) => p.status === 'failed')
      .map(([name, p]) => `${name}: ${p.error}`)
    const genErr = m.generator?.status === 'failed' ? `generator: ${m.generator.error}` : null
    const details = [...failedPkgs, genErr].filter(Boolean).join('; ')
    return { ready: false, reason: `session failed: ${details}`, fatal: true }
  }

  if (m.status === 'ready') {
    return { ready: true }
  }

  // Still starting
  const pkgStatuses = Object.entries(m.packages)
    .filter(([, p]) => p.status !== 'ready')
    .map(([name, p]) => `${name}:${p.status}`)

  if (pkgStatuses.length > 0) {
    return { ready: false, reason: `packages not ready: ${pkgStatuses.join(', ')}` }
  }

  if (m.generator?.status === 'running') {
    return { ready: false, reason: 'generator still running' }
  }

  return { ready: false, reason: `session status: ${m.status}` }
}

async function waitForReady() {
  const startedAt = Date.now()
  let lastReason = ''

  while (Date.now() - startedAt < timeoutMs) {
    const result = checkReady()

    if (result.ready) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      console.log(`[wait] all packages and generator ready (${elapsed}s)`)
      process.exit(0)
    }

    if (result.fatal) {
      console.error(`[wait] fatal: ${result.reason}`)
      process.exit(1)
    }

    if (result.reason !== lastReason) {
      console.log(`[wait] ${result.reason}`)
      lastReason = result.reason
    }

    await new Promise(r => setTimeout(r, 300))
  }

  console.error(`[wait] timed out after ${timeoutMs / 1000}s`)
  const m = readManifest()
  if (m) {
    console.error(`[wait] final state: ${JSON.stringify(m.packages, null, 2)}`)
    console.error(`[wait] generator: ${JSON.stringify(m.generator, null, 2)}`)
  }
  process.exit(1)
}

await waitForReady()
