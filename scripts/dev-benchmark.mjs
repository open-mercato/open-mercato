/**
 * Benchmark runner for dev pipeline comparison.
 *
 * Usage:
 *   node scripts/dev-benchmark.mjs [--mode legacy|optimized|both] [--samples N] [--json]
 *
 * Runs both legacy and optimized dev startup, captures metrics,
 * and writes a JSON artifact to .ai/benchmarks/dev/.
 */

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus, totalmem, platform, arch, release } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const BENCHMARK_DIR = join(ROOT_DIR, '.ai', 'benchmarks', 'dev')

// Parse args
const args = process.argv.slice(2)
const modeIdx = args.indexOf('--mode')
const samplesIdx = args.indexOf('--samples')
const jsonFlag = args.includes('--json')
const mode = modeIdx !== -1 ? args[modeIdx + 1] : 'both'
const samples = samplesIdx !== -1 ? parseInt(args[samplesIdx + 1], 10) : 1

function getMachineMetadata() {
  let nodeVersion = 'unknown'
  let yarnVersion = 'unknown'
  try { nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim() } catch {}
  try { yarnVersion = execSync('yarn --version', { encoding: 'utf-8' }).trim() } catch {}

  return {
    os: platform(),
    arch: arch(),
    osRelease: release(),
    cpuModel: cpus()[0]?.model || 'unknown',
    cpuCores: cpus().length,
    totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
    nodeVersion,
    yarnVersion,
  }
}

function getProcessTreeRss() {
  try {
    if (platform() === 'win32') {
      const output = execSync(
        'powershell -Command "Get-Process node,next,esbuild -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum | Select-Object -ExpandProperty Sum"',
        { encoding: 'utf-8', timeout: 10000 }
      ).trim()
      return parseInt(output, 10) / (1024 * 1024) || 0
    } else if (platform() === 'darwin') {
      const output = execSync('ps -A -o rss,comm | grep -E "(node|next|esbuild)" | awk \'{sum += $1} END {print sum}\'', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
      return parseInt(output, 10) / 1024 || 0
    } else {
      const output = execSync('ps aux | grep -E "(node|next|esbuild)" | awk \'{sum += $6} END {print sum}\'', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
      return parseInt(output, 10) / 1024 || 0
    }
  } catch {
    return null
  }
}

function killProcessTree() {
  try {
    if (platform() === 'win32') {
      execSync('taskkill /f /fi "IMAGENAME eq node.exe" /fi "WINDOWTITLE ne *benchmark*" 2>NUL', {
        timeout: 5000,
        stdio: 'ignore',
      })
    } else {
      execSync('pkill -f "turbo.*watch" 2>/dev/null; pkill -f "watch-all.mjs" 2>/dev/null; pkill -f "next dev" 2>/dev/null; pkill -f "wait-for-packages" 2>/dev/null', {
        timeout: 5000,
        stdio: 'ignore',
      })
    }
  } catch {
    // expected
  }
}

const APP_PORT = process.env.PORT || 3000
const APP_BASE_URL = `http://localhost:${APP_PORT}`

const WARMUP_PAGES = [
  '/',
  '/backend/login',
  '/backend',
  '/backend/customers',
  '/backend/catalog',
  '/backend/sales',
  '/api/health',
]

async function fetchPage(url) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    clearTimeout(timeout)
    return resp.status
  } catch {
    return null
  }
}

async function warmupApp() {
  console.log('  warming up app (loading pages)...')
  for (const page of WARMUP_PAGES) {
    const url = `${APP_BASE_URL}${page}`
    const status = await fetchPage(url)
    if (status) {
      console.log(`    ${page} → ${status}`)
    } else {
      console.log(`    ${page} → failed`)
    }
  }
}

async function runScenario(name, command, args) {
  console.log(`\n── Running ${name} scenario ──`)
  const startTime = Date.now()

  const isWin = platform() === 'win32'

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
      detached: !isWin,
    })

    let readyTime = null
    let stdout = ''

    const onData = (data) => {
      const text = data.toString()
      stdout += text

      if (!readyTime) {
        if (text.includes('Ready in') || text.includes('ready') || text.includes('[4/4]')) {
          readyTime = Date.now() - startTime
          console.log(`  ${name}: ready signal detected (${(readyTime / 1000).toFixed(1)}s)`)
        }
      }
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    function killChild() {
      try {
        if (isWin) {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' })
        } else {
          process.kill(-child.pid, 'SIGTERM')
        }
      } catch {
        try { child.kill('SIGTERM') } catch { /* already dead */ }
      }
    }

    // Wait for startup, exercise the app, then measure steady-state
    const mainTimeout = setTimeout(async () => {
      if (!readyTime) {
        readyTime = Date.now() - startTime
      }

      // Give the app a moment to stabilize, then load real pages
      await new Promise(r => setTimeout(r, 5000))
      await warmupApp()

      // Wait for memory to settle after page compilation
      await new Promise(r => setTimeout(r, 10000))
      const rssMb = getProcessTreeRss()

      killChild()

      setTimeout(() => {
        killProcessTree()
        resolve({
          coldStartMs: readyTime,
          steadyStateRssMb: rssMb,
        })
      }, 3000)
    }, 60000) // Wait up to 60s for ready

    child.on('close', () => {
      clearTimeout(mainTimeout)
      resolve({
        coldStartMs: readyTime || Date.now() - startTime,
        steadyStateRssMb: null,
      })
    })
  })
}

async function main() {
  console.log('═══ dev:benchmark ═══')
  console.log(`Mode: ${mode}, Samples: ${samples}`)

  const metadata = getMachineMetadata()
  console.log(`Machine: ${metadata.cpuModel} (${metadata.cpuCores} cores), ${metadata.totalMemoryMb}MB RAM`)
  console.log(`Node: ${metadata.nodeVersion}, Yarn: ${metadata.yarnVersion}`)

  const results = {
    timestamp: new Date().toISOString(),
    machine: metadata,
    mode,
    samples,
    legacy: [],
    optimized: [],
  }

  for (let i = 0; i < samples; i++) {
    if (samples > 1) console.log(`\n── Sample ${i + 1}/${samples} ──`)

    killProcessTree()
    await new Promise(r => setTimeout(r, 2000))

    if (mode === 'legacy' || mode === 'both') {
      const legacyResult = await runScenario('legacy', 'yarn', ['dev:legacy'])
      results.legacy.push(legacyResult)
      killProcessTree()
      await new Promise(r => setTimeout(r, 3000))
    }

    if (mode === 'optimized' || mode === 'both') {
      const optimizedResult = await runScenario('optimized', 'node', [join(__dirname, 'dev-optimized.mjs')])
      results.optimized.push(optimizedResult)
      killProcessTree()
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // Compute medians
  const median = (arr) => {
    const sorted = [...arr].filter(x => x != null).sort((a, b) => a - b)
    if (sorted.length === 0) return null
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  }

  const summary = {
    legacy: results.legacy.length > 0 ? {
      medianColdStartMs: median(results.legacy.map(r => r.coldStartMs)),
      medianRssMb: median(results.legacy.map(r => r.steadyStateRssMb)),
    } : null,
    optimized: results.optimized.length > 0 ? {
      medianColdStartMs: median(results.optimized.map(r => r.coldStartMs)),
      medianRssMb: median(results.optimized.map(r => r.steadyStateRssMb)),
    } : null,
  }

  results.summary = summary

  // Print summary
  console.log('\n═══ Results ═══')
  if (summary.legacy) {
    console.log(`Legacy:    coldStart=${summary.legacy.medianColdStartMs}ms  RSS=${summary.legacy.medianRssMb}MB`)
  }
  if (summary.optimized) {
    console.log(`Optimized: coldStart=${summary.optimized.medianColdStartMs}ms  RSS=${summary.optimized.medianRssMb}MB`)
  }
  if (summary.legacy && summary.optimized) {
    const startImprovement = summary.legacy.medianColdStartMs && summary.optimized.medianColdStartMs
      ? ((1 - summary.optimized.medianColdStartMs / summary.legacy.medianColdStartMs) * 100).toFixed(1)
      : null
    const rssImprovement = summary.legacy.medianRssMb && summary.optimized.medianRssMb
      ? ((1 - summary.optimized.medianRssMb / summary.legacy.medianRssMb) * 100).toFixed(1)
      : null
    if (startImprovement) console.log(`Cold start improvement: ${startImprovement}%`)
    if (rssImprovement) console.log(`RSS improvement: ${rssImprovement}%`)
  }

  // Write artifact
  mkdirSync(BENCHMARK_DIR, { recursive: true })
  const artifactPath = join(BENCHMARK_DIR, `benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(artifactPath, JSON.stringify(results, null, 2))
  console.log(`\nArtifact written to ${artifactPath}`)

  if (jsonFlag) {
    console.log(JSON.stringify(results, null, 2))
  }

  process.exit(0)
}

await main()
