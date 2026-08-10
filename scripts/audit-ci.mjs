#!/usr/bin/env node
// Dependency CVE audit for CI.
//
// Why this exists instead of a bare `yarn npm audit`:
// the npm registry's bulk advisories endpoint
// (https://registry.npmjs.org/-/npm/v1/security/advisories/bulk) currently
// returns a gzip-compressed body WITHOUT a `Content-Encoding: gzip` response
// header (and ignores `Accept-Encoding: identity`). Yarn 4.x's HTTP client
// correctly declines to auto-decompress a body with no encoding header, so
// `yarn npm audit` dies with `ParseError: ... is not valid JSON` before it can
// evaluate a single advisory — failing every audit whose result cache misses.
//
// This script performs the same audit (all resolved packages == `--all
// --recursive`, fail on `high`+ severity) but decompresses defensively by
// sniffing the gzip magic bytes, so it works whether or not npm sends the
// header. It fails closed (exit 2) if advisory data cannot be retrieved, and
// exits 1 on any advisory at or above the threshold.
//
// The one documented escape hatch is `.audit-allowlist.json` next to the
// lockfile, for an advisory with NO published fix — every version of the
// package is in the vulnerable range, so no bump can clear it and the gate
// would otherwise stay red forever on a graph nobody can repair. A waiver is
// deliberately hard to abuse: it must name the advisory id, the package, the
// exact vulnerable range the registry reports, a reason, and an expiry no more
// than MAX_WAIVER_DAYS away. Anything malformed fails the run closed (exit 2),
// an expired or non-matching waiver suppresses nothing, and every suppression
// is printed on every run so it stays visible in the job log.
//
// Revert to `yarn npm audit --all --recursive --severity high` once the npm
// registry restores a correct `Content-Encoding` header on that endpoint.

import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

export const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']
export const ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk'
export const ALLOWLIST_FILE = '.audit-allowlist.json'
export const MAX_WAIVER_DAYS = 90
const WAIVER_FIELDS = ['advisory', 'package', 'vulnerableVersions', 'reason', 'expires']

export function parseArgs(argv) {
  const inlineSeverity = (argv.find((arg) => arg.startsWith('--severity=')) || '').split('=')[1]
  const severityIndex = argv.indexOf('--severity')
  const threshold = inlineSeverity
    || (severityIndex >= 0 && argv[severityIndex + 1] && !argv[severityIndex + 1].startsWith('--')
      ? argv[severityIndex + 1]
      : 'high')
  if (!SEVERITY_ORDER.includes(threshold)) {
    throw new Error(`unknown --severity "${threshold}" (expected one of ${SEVERITY_ORDER.join(', ')})`)
  }
  const lockPath = path.resolve(argv.find((arg) => arg.endsWith('yarn.lock')) || 'yarn.lock')
  return {
    threshold,
    lockPath,
    allowlistPath: path.join(path.dirname(lockPath), ALLOWLIST_FILE),
  }
}

export function readLockPackages(lockFile) {
  // Yarn v4 lockfile: each top-level block carries `resolution: "<name>@<protocol>:<selector>"`
  // and `version: "<resolved>"`. Only npm-protocol packages can carry npm advisories.
  const raw = fs.readFileSync(lockFile, 'utf8')
  const packages = new Map()
  for (const block of raw.split(/\n(?=\S)/)) {
    const resolutionMatch = block.match(/\n\s+resolution:\s+"([^"]+)"/)
    const versionMatch = block.match(/\n\s+version:\s+"?([^"\n]+)"?/)
    if (!resolutionMatch || !versionMatch) continue
    const resolution = resolutionMatch[1]
    const protocolMatch = resolution.match(/^(.+?)@(npm|patch):/)
    if (!protocolMatch) continue // workspace/file/link/portal/git — no npm advisory surface
    const name = protocolMatch[1]
    const version = versionMatch[1].trim()
    if (!name || !version) continue
    if (!packages.has(name)) packages.set(name, new Set())
    packages.get(name).add(version)
  }
  return packages
}

export function decodeAdvisoryResponse(bytes) {
  const body = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
    ? zlib.gunzipSync(bytes).toString('utf8')
    : bytes.toString('utf8')
  const result = JSON.parse(body)
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('advisory response must be an object')
  }
  for (const [name, entries] of Object.entries(result)) {
    if (!Array.isArray(entries)) throw new Error(`advisory response for ${name} must be an array`)
    for (const advisory of entries) {
      if (!advisory || typeof advisory !== 'object' || !SEVERITY_ORDER.includes(advisory.severity)) {
        throw new Error(`advisory response for ${name} contains an invalid severity`)
      }
    }
  }
  return result
}

export async function fetchAdvisories(chunk, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const endpoint = options.endpoint ?? ENDPOINT
  const timeoutMs = options.timeoutMs ?? 15_000
  const retryDelayMs = options.retryDelayMs ?? 250
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      return decodeAdvisoryResponse(bytes)
    } catch (error) {
      lastError = error
      if (attempt < 2 && retryDelayMs > 0) await delay(retryDelayMs * (2 ** attempt))
    }
  }
  throw lastError
}

export function collectFlaggedAdvisories(advisories, threshold) {
  const thresholdIndex = SEVERITY_ORDER.indexOf(threshold)
  const flagged = []
  for (const [name, entries] of Object.entries(advisories)) {
    for (const advisory of entries) {
      if (SEVERITY_ORDER.indexOf(advisory.severity) >= thresholdIndex) {
        flagged.push({ name, severity: advisory.severity, range: advisory.vulnerable_versions, title: advisory.title, url: advisory.url })
      }
    }
  }
  flagged.sort((left, right) => SEVERITY_ORDER.indexOf(right.severity) - SEVERITY_ORDER.indexOf(left.severity))
  return flagged
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function normalizeRange(range) {
  return String(range ?? '').replace(/\s+/g, '')
}

export function readWaivers(allowlistPath, currentDate = today()) {
  if (!fs.existsSync(allowlistPath)) return []
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  } catch (error) {
    throw new Error(`${allowlistPath} is not valid JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.waivers)) {
    throw new Error(`${allowlistPath} must be an object with a "waivers" array`)
  }
  return parsed.waivers.map((waiver, index) => {
    const label = `${allowlistPath} waiver #${index + 1}`
    if (!waiver || typeof waiver !== 'object' || Array.isArray(waiver)) {
      throw new Error(`${label} must be an object`)
    }
    for (const field of WAIVER_FIELDS) {
      if (typeof waiver[field] !== 'string' || waiver[field].trim() === '') {
        throw new Error(`${label} is missing a non-empty "${field}"`)
      }
    }
    if (!/^GHSA-[\da-z]{4}-[\da-z]{4}-[\da-z]{4}$/i.test(waiver.advisory)) {
      throw new Error(`${label} has an "advisory" that is not a GHSA id: ${waiver.advisory}`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(waiver.expires) || Number.isNaN(Date.parse(`${waiver.expires}T00:00:00Z`))) {
      throw new Error(`${label} has an "expires" that is not a YYYY-MM-DD date: ${waiver.expires}`)
    }
    if (daysBetween(currentDate, waiver.expires) > MAX_WAIVER_DAYS) {
      throw new Error(`${label} expires more than ${MAX_WAIVER_DAYS} days out (${waiver.expires}); waivers must be re-reviewed`)
    }
    return waiver
  })
}

export function applyWaivers(flagged, waivers, currentDate = today()) {
  // A waiver matches only when the package, the advisory id AND the exact
  // vulnerable range the registry reports all agree, so a re-scoped advisory
  // (or a different advisory for the same package) is never silently covered.
  const matches = (advisory, waiver) => advisory.name === waiver.package
    && String(advisory.url ?? '').toUpperCase().includes(waiver.advisory.toUpperCase())
    && normalizeRange(advisory.range) === normalizeRange(waiver.vulnerableVersions)

  const reported = []
  const suppressed = []
  const expired = []
  const used = new Set()
  for (const advisory of flagged) {
    const waiver = waivers.find((candidate) => matches(advisory, candidate))
    if (!waiver) {
      reported.push(advisory)
      continue
    }
    used.add(waiver)
    if (waiver.expires < currentDate) {
      expired.push({ advisory, waiver })
      reported.push(advisory)
      continue
    }
    suppressed.push({ advisory, waiver })
  }
  return { reported, suppressed, expired, unused: waivers.filter((waiver) => !used.has(waiver)) }
}

export async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`audit-ci: ${error.message}`)
    return 2
  }

  const { lockPath, allowlistPath, threshold } = options
  let waivers
  try {
    // Read before the scan so a malformed allowlist fails the run closed
    // rather than after a few minutes of network work.
    waivers = readWaivers(allowlistPath)
  } catch (error) {
    console.error(`audit-ci: ${error.message}`)
    return 2
  }

  const packages = readLockPackages(lockPath)
  const names = [...packages.keys()]
  if (names.length === 0) {
    console.error(`audit-ci: no npm packages found in ${lockPath}`)
    return 2
  }
  const advisories = {}
  for (let i = 0; i < names.length; i += 200) {
    const chunk = {}
    for (const name of names.slice(i, i + 200)) chunk[name] = [...packages.get(name)]
    let result
    try {
      result = await fetchAdvisories(chunk)
    } catch (error) {
      // Fail closed — never pass the gate when advisory data is unavailable.
      console.error(`audit-ci: could not retrieve advisories (batch ${i / 200 + 1}): ${error.message}`)
      return 2
    }
    Object.assign(advisories, result)
  }

  const flagged = collectFlaggedAdvisories(advisories, threshold)
  const { reported, suppressed, expired, unused } = applyWaivers(flagged, waivers)

  console.log(`audit-ci: scanned ${names.length} packages; threshold=${threshold}+`)
  for (const { advisory, waiver } of suppressed) {
    console.log(`audit-ci: waived until ${waiver.expires} — [${advisory.severity}] ${advisory.name} ${advisory.range} — ${advisory.title} (${advisory.url})`)
    console.log(`  reason: ${waiver.reason}`)
  }
  for (const { waiver } of expired) {
    console.error(`audit-ci: the waiver for ${waiver.advisory} (${waiver.package}) expired on ${waiver.expires} — it no longer suppresses anything.`)
  }
  for (const waiver of unused) {
    console.error(`audit-ci: the waiver for ${waiver.advisory} (${waiver.package}) matched no advisory — remove it from ${ALLOWLIST_FILE}.`)
  }
  if (reported.length === 0) {
    const waived = suppressed.length > 0 ? ` (${suppressed.length} waived)` : ''
    console.log(`audit-ci: no advisories at or above threshold${waived}.`)
    return 0
  }
  console.error(`audit-ci: ${reported.length} advisory(ies) at or above ${threshold}:`)
  for (const advisory of reported) {
    console.error(`  [${advisory.severity}] ${advisory.name} ${advisory.range} — ${advisory.title} (${advisory.url})`)
  }
  return 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode
  }).catch((error) => {
    console.error(`audit-ci: unexpected failure: ${error.stack || error.message}`)
    process.exitCode = 2
  })
}
