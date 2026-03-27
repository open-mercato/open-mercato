/**
 * Optimized dev pipeline orchestrator.
 *
 * Replaces the legacy `yarn build:packages && yarn watch:packages & sleep 3 && yarn dev:app` with:
 * 1. Cache-aware build:packages (via Turbo with cache enabled)
 * 2. Single-process unified watcher (scripts/watch-all.mjs)
 * 3. Manifest-based readiness wait (scripts/wait-for-packages.mjs)
 * 4. yarn dev:app
 *
 * Phase 10 — scoped memory options: applies --max-old-space-size only to this process tree.
 *
 * Cross-platform: works on Linux, macOS, and Windows.
 */

import { spawn, execSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const isWindows = platform() === 'win32'

const SESSION_ID = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`

// Phase 10 — Scoped memory ceiling
const maxOldSpaceSize = process.env.OM_DEV_MAX_OLD_SPACE_SIZE || '2048'
const nodeOptions = [
  process.env.NODE_OPTIONS || '',
  `--max-old-space-size=${maxOldSpaceSize}`,
].filter(Boolean).join(' ')

// Resolve the yarn binary path for cross-platform support.
// On Windows, spawn needs the full path or shell:true; on macOS/Linux
// the PATH from the parent process is inherited.
function resolveYarn() {
  try {
    const yarnPath = execSync(isWindows ? 'where yarn' : 'which yarn', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim().split('\n')[0]
    return yarnPath
  } catch {
    return 'yarn'
  }
}

const YARN = resolveYarn()

const children = []

function spawnChild(command, args, opts = {}) {
  const { env: extraEnv, ...rest } = opts
  const child = spawn(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    ...rest,
  })
  children.push(child)
  return child
}

function killAll() {
  for (const child of children) {
    if (!child.pid) continue
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      // already dead
    }
  }
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0 || code === null) resolve(code)
      else reject(new Error(`Process exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

async function main() {
  console.log('─── dev:optimized ───')
  console.log(`Session: ${SESSION_ID}`)
  console.log(`Memory ceiling: ${maxOldSpaceSize}MB`)
  console.log('')

  const startTime = Date.now()

  // Step 1: Build packages (Turbo cache enabled in turbo.json)
  console.log('[1/4] Building packages (cache-aware)...')
  const buildChild = spawnChild(YARN, ['build:packages'], {
    env: { NODE_OPTIONS: nodeOptions },
  })
  try {
    await waitForExit(buildChild)
  } catch (err) {
    console.error('Package build failed:', err.message)
    process.exit(1)
  }

  const buildTime = Date.now() - startTime
  console.log(`[1/4] Package build complete (${(buildTime / 1000).toFixed(1)}s)`)

  // Step 2: Start unified watcher
  console.log('[2/4] Starting unified watcher...')
  const watchChild = spawnChild(process.execPath, [
    join(__dirname, 'watch-all.mjs'),
    '--session', SESSION_ID,
  ], {
    env: { NODE_OPTIONS: nodeOptions },
  })

  // Step 3: Wait for readiness
  console.log('[3/4] Waiting for packages and generator...')
  const waitChild = spawnChild(process.execPath, [
    join(__dirname, 'wait-for-packages.mjs'),
    '--session', SESSION_ID,
    '--timeout', '120000',
  ])

  try {
    await waitForExit(waitChild)
  } catch (err) {
    console.error('Readiness wait failed:', err.message)
    killAll()
    process.exit(1)
  }

  const readyTime = Date.now() - startTime
  console.log(`[3/4] Ready (${(readyTime / 1000).toFixed(1)}s total)`)

  // Step 4: Start the app
  console.log('[4/4] Starting app...')
  const appChild = spawnChild(YARN, ['dev:app'])

  // Keep running until app or watcher exits
  try {
    await Promise.race([
      waitForExit(watchChild),
      waitForExit(appChild),
    ])
  } catch {
    // One of them exited with an error
  }

  killAll()
  process.exit(0)
}

// Cleanup on signals
process.on('SIGINT', () => {
  console.log('\nShutting down dev:optimized...')
  killAll()
  setTimeout(() => process.exit(0), 2000)
})

process.on('SIGTERM', () => {
  killAll()
  setTimeout(() => process.exit(0), 2000)
})

await main()
