#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

import { sampleProcessTreeMemory, summarizeMemorySamples } from './dev-memory-sampler.mjs'

const DEFAULT_INTERVAL_MS = 250
const DEFAULT_OUT_DIR = path.join('.mercato', 'standalone-build-rss')

export function parseStandaloneBuildProfileArgs(argv) {
  const args = {
    appDir: null,
    label: null,
    intervalMs: DEFAULT_INTERVAL_MS,
    outDir: DEFAULT_OUT_DIR,
    report: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    switch (token) {
      case '--app-dir':
        args.appDir = argv[++index] ?? null
        break
      case '--label':
        args.label = argv[++index] ?? null
        break
      case '--interval': {
        const parsed = Number(argv[++index])
        if (Number.isFinite(parsed) && parsed > 0) args.intervalMs = parsed
        break
      }
      case '--out-dir':
        args.outDir = argv[++index] ?? DEFAULT_OUT_DIR
        break
      case '--report':
        args.report = true
        break
      case '-h':
      case '--help':
        args.help = true
        break
      default:
        if (!token.startsWith('--') && !args.label) args.label = token
        break
    }
  }

  return args
}

function formatMb(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : '?'
}

function formatDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?'
  return `${Math.round(value / 100) / 10}s`
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function groupRunMedians(reports) {
  const grouped = new Map()
  for (const report of reports) {
    const groupLabel = String(report.label).replace(/-\d+$/, '')
    const entries = grouped.get(groupLabel) ?? []
    entries.push(report)
    grouped.set(groupLabel, entries)
  }

  return Array.from(grouped.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([label, entries]) => ({
      label,
      runs: entries.length,
      startedAt: entries.map((entry) => entry.startedAt).sort()[0],
      peakTotalMb: median(entries.map((entry) => entry.summary?.peakTotalMb)),
      durationMs: median(entries.map((entry) => entry.durationMs)),
    }))
    .sort((left, right) => Date.parse(left.startedAt ?? '') - Date.parse(right.startedAt ?? ''))
}

export function renderStandaloneBuildReportTable(reports) {
  if (reports.length === 0) return '_No reports found._'

  const sorted = reports.slice().sort((left, right) => {
    const leftTime = Date.parse(left.startedAt ?? '')
    const rightTime = Date.parse(right.startedAt ?? '')
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    return String(left.label).localeCompare(String(right.label))
  })

  const lines = [
    '| Label | Peak RSS (MB) | Mean RSS (MB) | Build time | Exit | Samples | Node options |',
    '|-------|---------------|---------------|------------|------|---------|--------------|',
  ]

  for (const report of sorted) {
    lines.push(
      `| \`${report.label}\` | ${formatMb(report.summary?.peakTotalMb)} | ${formatMb(report.summary?.meanTotalMb)} | ${formatDuration(report.durationMs)} | ${report.exitCode ?? '?'} | ${report.summary?.sampleCount ?? '?'} | \`${report.nodeOptions || '(unset)'}\` |`,
    )
  }

  const medians = groupRunMedians(sorted)
  if (medians.length > 0) {
    lines.push('')
    lines.push('### Run medians')
    lines.push('')
    lines.push('| Group | Runs | Median peak RSS (MB) | Median build time |')
    lines.push('|-------|------|----------------------|-------------------|')
    for (const entry of medians) {
      lines.push(`| \`${entry.label}\` | ${entry.runs} | ${formatMb(entry.peakTotalMb)} | ${formatDuration(entry.durationMs)} |`)
    }
  }

  if (medians.length >= 2 || (medians.length === 0 && sorted.length >= 2)) {
    const baseline = medians.length >= 2 ? medians[0] : sorted[0]
    const candidate = medians.length >= 2 ? medians[medians.length - 1] : sorted[sorted.length - 1]
    const baselinePeak = baseline.peakTotalMb ?? baseline.summary?.peakTotalMb
    const candidatePeak = candidate.peakTotalMb ?? candidate.summary?.peakTotalMb
    const baselineDuration = baseline.durationMs
    const candidateDuration = candidate.durationMs
    if (typeof baselinePeak === 'number' && typeof candidatePeak === 'number') {
      const deltaMb = Math.round((candidatePeak - baselinePeak) * 100) / 100
      const deltaPercent = baselinePeak === 0
        ? null
        : Math.round((deltaMb / baselinePeak) * 10_000) / 100
      lines.push('')
      lines.push(
        `**Peak RSS delta:** \`${candidate.label}\` − \`${baseline.label}\` = **${deltaMb >= 0 ? '+' : ''}${deltaMb} MB${deltaPercent == null ? '' : ` (${deltaPercent >= 0 ? '+' : ''}${deltaPercent}%)`}**.`,
      )
    }
    if (typeof baselineDuration === 'number' && typeof candidateDuration === 'number') {
      const deltaMs = candidateDuration - baselineDuration
      lines.push(
        `**Build-time delta:** \`${candidate.label}\` − \`${baseline.label}\` = **${deltaMs >= 0 ? '+' : ''}${formatDuration(deltaMs)}**.`,
      )
    }
  }

  return lines.join('\n')
}

function readReports(outDir) {
  if (!fs.existsSync(outDir)) return []
  return fs.readdirSync(outDir)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(outDir, file), 'utf8'))
        return parsed && typeof parsed.label === 'string' ? [parsed] : []
      } catch {
        return []
      }
    })
}

function safeLabel(label) {
  return label.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function readCommandVersion(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function resolveEffectiveNodeOptions(buildScript) {
  const scriptMatch = buildScript.match(/(?:^|\s)NODE_OPTIONS=([^\s]+)/)
  return scriptMatch?.[1] ?? process.env.NODE_OPTIONS ?? ''
}

function collectProvenance(resolvedAppDir, packageJson, buildScript) {
  const modulesPath = path.join(resolvedAppDir, 'src', 'modules.ts')
  const lockPath = path.join(resolvedAppDir, 'yarn.lock')
  let repoSha = null
  try {
    repoSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {}

  return {
    repoSha,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    yarnVersion: readCommandVersion('yarn', ['--version'], resolvedAppDir),
    nextVersion: packageJson.dependencies?.next ?? packageJson.devDependencies?.next ?? null,
    packageJsonHash: hashFile(path.join(resolvedAppDir, 'package.json')),
    lockfileHash: hashFile(lockPath),
    modulesHash: hashFile(modulesPath),
    buildScript,
  }
}

async function profileStandaloneBuild({ appDir, label, intervalMs, outDir, log }) {
  const resolvedAppDir = path.resolve(appDir)
  const packageJsonPath = path.join(resolvedAppDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Standalone app package.json not found: ${packageJsonPath}`)
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const buildScript = packageJson.scripts?.build
  if (typeof buildScript !== 'string' || buildScript.trim().length === 0) {
    throw new Error(`Standalone app has no build script: ${packageJsonPath}`)
  }

  const nextOutputDir = path.join(resolvedAppDir, '.mercato', 'next')
  fs.rmSync(nextOutputDir, { recursive: true, force: true })
  log(`[standalone-build-profile] removed cold-build output: ${nextOutputDir}`)

  const startedAt = new Date().toISOString()
  const startedAtMs = Date.now()
  const samples = []
  const child = spawn('yarn', ['build'], {
    cwd: resolvedAppDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!child.pid) throw new Error('Failed to spawn standalone `yarn build`')

  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  log(`[standalone-build-profile] tracking pid=${child.pid} every ${intervalMs}ms`)

  const exitResult = new Promise((resolve) => {
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  let finished = false
  let result = null
  exitResult.then((value) => {
    result = value
    finished = true
  })

  while (!finished) {
    const sample = await sampleProcessTreeMemory(child.pid, { includeCgroup: false })
    if (sample) samples.push(sample)
    await Promise.race([delay(intervalMs), exitResult])
  }

  const durationMs = Date.now() - startedAtMs
  const report = {
    label,
    appDir: resolvedAppDir,
    command: 'yarn build',
    rootPid: child.pid,
    nodeOptions: resolveEffectiveNodeOptions(buildScript),
    coldBuild: true,
    provenance: collectProvenance(resolvedAppDir, packageJson, buildScript),
    intervalMs,
    durationMs,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
    samples,
    summary: summarizeMemorySamples(samples),
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${safeLabel(label)}.json`)
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
  log(`[standalone-build-profile] report: ${outPath}`)
  log(`[standalone-build-profile] peak RSS: ${report.summary.peakTotalMb} MB`)
  log(`[standalone-build-profile] build time: ${formatDuration(durationMs)}`)

  if (report.exitCode !== 0) {
    throw new Error(`Standalone build failed with exit code ${report.exitCode ?? 'unknown'}${report.signal ? ` (${report.signal})` : ''}`)
  }

  return report
}

function printHelp() {
  process.stdout.write(`Usage:
  yarn build:standalone:profile --app-dir <generated-app> --label <name>
  yarn build:standalone:profile:report

Options:
  --app-dir <dir>       Generated standalone app containing package.json.
  --label <name>        Report label and filename.
  --interval <ms>       RSS sampling interval. Default: ${DEFAULT_INTERVAL_MS}.
  --out-dir <dir>       Report directory. Default: ${DEFAULT_OUT_DIR}.
  --report              Render all reports in the output directory as Markdown.
  -h, --help            Show this help.
`)
}

async function main() {
  const args = parseStandaloneBuildProfileArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  if (process.platform === 'win32') {
    throw new Error('Standalone build RSS profiling requires Darwin or Linux `ps` output')
  }
  if (args.report) {
    process.stdout.write(`${renderStandaloneBuildReportTable(readReports(args.outDir))}\n`)
    return
  }
  if (!args.appDir) throw new Error('Missing --app-dir <generated-app>')
  const label = args.label ?? `standalone-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await profileStandaloneBuild({
    appDir: args.appDir,
    label,
    intervalMs: args.intervalMs,
    outDir: args.outDir,
    log: (message) => process.stderr.write(`${message}\n`),
  })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
