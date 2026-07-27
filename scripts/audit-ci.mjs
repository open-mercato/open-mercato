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
// header. It NEVER softens the gate: it fails closed (exit 2) if advisory data
// cannot be retrieved, and exits 1 on any advisory at or above the threshold.
//
// Revert to `yarn npm audit --all --recursive --severity high` once the npm
// registry restores a correct `Content-Encoding` header on that endpoint.

import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']
const AUDIT_REQUEST_TIMEOUT_MS = 15_000
const inlineThreshold = (process.argv.find((argument) => argument.startsWith('--severity=')) || '').split('=')[1]
const thresholdIndexInArgs = process.argv.indexOf('--severity')
const separateThreshold = thresholdIndexInArgs >= 0
  ? process.argv[thresholdIndexInArgs + 1]
  : undefined
const thresholdArg = inlineThreshold
  || (separateThreshold && !separateThreshold.startsWith('--') ? separateThreshold : 'high')
const thresholdIndex = SEVERITY_ORDER.indexOf(thresholdArg)
if (thresholdIndex < 0) {
  console.error(`audit-ci: unknown --severity "${thresholdArg}" (expected one of ${SEVERITY_ORDER.join(', ')})`)
  process.exit(2)
}

const ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk'
const lockPath = path.resolve(process.argv.find((a) => a.endsWith('yarn.lock')) || 'yarn.lock')

function readLockPackages(lockFile) {
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

export async function fetchAdvisories(
  chunk,
  { fetchImpl = globalThis.fetch, timeoutMs = AUDIT_REQUEST_TIMEOUT_MS } = {},
) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      const body = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
        ? zlib.gunzipSync(bytes).toString('utf8')
        : bytes.toString('utf8')
      return JSON.parse(body)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function main() {
  const packages = readLockPackages(lockPath)
  const names = [...packages.keys()]
  if (names.length === 0) {
    console.error(`audit-ci: no npm packages found in ${lockPath}`)
    process.exit(2)
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
      process.exit(2)
    }
    Object.assign(advisories, result)
  }

  const flagged = []
  for (const [name, entries] of Object.entries(advisories)) {
    for (const advisory of entries) {
      if (SEVERITY_ORDER.indexOf(advisory.severity) >= thresholdIndex) {
        flagged.push({ name, severity: advisory.severity, range: advisory.vulnerable_versions, title: advisory.title, url: advisory.url })
      }
    }
  }

  console.log(`audit-ci: scanned ${names.length} packages; threshold=${thresholdArg}+`)
  if (flagged.length === 0) {
    console.log('audit-ci: no advisories at or above threshold.')
    process.exit(0)
  }
  flagged.sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity))
  console.error(`audit-ci: ${flagged.length} advisory(ies) at or above ${thresholdArg}:`)
  for (const f of flagged) console.error(`  [${f.severity}] ${f.name} ${f.range} — ${f.title} (${f.url})`)
  process.exit(1)
}

const isEntryPoint = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isEntryPoint) {
  main().catch((error) => {
    console.error(`audit-ci: unexpected failure: ${error.stack || error.message}`)
    process.exit(2)
  })
}
