#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { summarize, round } from './lib/stats.mjs'

export async function calibrate(baseUrl, { samples = 30, timeoutMs = 10000 } = {}) {
  const durations = []
  let failures = 0
  const total = samples + 1
  for (let index = 0; index < total; index += 1) {
    const started = performance.now()
    try {
      const response = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(timeoutMs) })
      await response.arrayBuffer()
      if (!response.ok) failures += 1
    } catch {
      failures += 1
    }
    if (index > 0) durations.push(performance.now() - started)
  }
  const stats = summarize(durations)
  return {
    url: `${baseUrl}/api/healthz`,
    samples,
    failures,
    p50: round(stats.p50, 2),
    p95: round(stats.p95, 2),
    min: round(stats.min, 2),
    max: round(stats.max, 2),
    measuredAt: new Date().toISOString(),
  }
}

async function main() {
  const [baseUrl, ...rest] = process.argv.slice(2)
  if (!baseUrl) {
    process.stderr.write('Usage: node perf/scripts/calibrate.mjs <base-url> [--samples 30]\n')
    process.exit(2)
  }
  const samplesIndex = rest.indexOf('--samples')
  const samples = samplesIndex >= 0 ? Number(rest[samplesIndex + 1]) : 30
  if (process.env.INSECURE_TLS !== '0') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const result = await calibrate(baseUrl.replace(/\/+$/, ''), { samples })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
