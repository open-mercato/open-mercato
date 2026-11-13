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
//
// A flagged advisory with no upstream fix would otherwise block the gate
// forever; audit-ci-allowlist.json holds narrowly-scoped, justified
// exceptions (matched by GHSA id) for exactly that case.
//
// `--baseline <lockfile>` turns the gate into a "new advisories only" check:
// an advisory also flagged against the baseline lockfile (the PR base / the
// previous push) is reported but does not fail the run. Without it a PR that
// merely adds one clean dependency stays red for every advisory already on the
// base branch, which it can neither cause nor fix. Pre-existing advisories are
// owned by the scheduled `.github/workflows/audit.yml`, which runs without a
// baseline and keeps a tracking issue open until they are resolved.

import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']
export const ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk'
export const ALLOWLIST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audit-ci-allowlist.json')

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
  const inlineBaseline = (argv.find((arg) => arg.startsWith('--baseline=')) || '').slice('--baseline='.length)
  const baselineIndex = argv.indexOf('--baseline')
  const separateBaseline = baselineIndex >= 0 ? argv[baselineIndex + 1] : undefined
  if (baselineIndex >= 0 && (!separateBaseline || separateBaseline.startsWith('--'))) {
    throw new Error('--baseline requires a lockfile path')
  }
  const baseline = inlineBaseline || separateBaseline
  const lockArg = argv.find((arg, index) => arg.endsWith('yarn.lock') && !arg.startsWith('--') && (baselineIndex < 0 || index !== baselineIndex + 1))
  return {
    threshold,
    lockPath: path.resolve(lockArg || 'yarn.lock'),
    baselinePath: baseline ? path.resolve(baseline) : null,
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

export function extractGhsaId(url) {
  const match = typeof url === 'string' ? url.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i) : null
  return match ? match[0].toUpperCase() : null
}

// Advisories with no upstream fix (e.g. an archived package) would otherwise
// block the gate forever. Each entry needs a recorded reason so the exception
// stays reviewable — see audit-ci-allowlist.json.
export function loadAllowlist(filePath = ALLOWLIST_PATH) {
  if (!fs.existsSync(filePath)) return new Map()
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || typeof parsed.advisories !== 'object') {
    throw new Error(`${filePath} must contain an "advisories" object`)
  }
  return new Map(Object.entries(parsed.advisories).map(([ghsaId, entry]) => [ghsaId.toUpperCase(), entry]))
}

export function partitionAllowlisted(flagged, allowlist) {
  const blocking = []
  const suppressed = []
  for (const advisory of flagged) {
    const ghsaId = extractGhsaId(advisory.url)
    const exemption = ghsaId ? allowlist.get(ghsaId) : undefined
    if (exemption) suppressed.push({ ...advisory, ghsaId, reason: exemption.reason })
    else blocking.push(advisory)
  }
  return { blocking, suppressed }
}

function advisoryKey(advisory) {
  return `${advisory.name}\u0000${extractGhsaId(advisory.url) ?? advisory.url ?? advisory.title}`
}

// An advisory is pre-existing when the same advisory on the same package is
// already flagged against the baseline lockfile — even if the change moved the
// package to another still-vulnerable version, it did not introduce the issue.
export function partitionByBaseline(flagged, baselineFlagged) {
  const baselineKeys = new Set(baselineFlagged.map(advisoryKey))
  const introduced = []
  const preexisting = []
  for (const advisory of flagged) {
    if (baselineKeys.has(advisoryKey(advisory))) preexisting.push(advisory)
    else introduced.push(advisory)
  }
  return { introduced, preexisting }
}

// Returns null (after logging) when the lockfile cannot be audited, so callers fail closed.
async function auditLockfile(lockPath, threshold, fetchImpl) {
  const packages = readLockPackages(lockPath)
  const names = [...packages.keys()]
  if (names.length === 0) {
    console.error(`audit-ci: no npm packages found in ${lockPath}`)
    return null
  }
  const advisories = {}
  for (let i = 0; i < names.length; i += 200) {
    const chunk = {}
    for (const name of names.slice(i, i + 200)) chunk[name] = [...packages.get(name)]
    let result
    try {
      result = await fetchAdvisories(chunk, { fetchImpl })
    } catch (error) {
      // Fail closed — never pass the gate when advisory data is unavailable.
      console.error(`audit-ci: could not retrieve advisories for ${lockPath} (batch ${i / 200 + 1}): ${error.message}`)
      return null
    }
    Object.assign(advisories, result)
  }
  return { scanned: names.length, flagged: collectFlaggedAdvisories(advisories, threshold) }
}

export async function main(argv = process.argv.slice(2), { fetchImpl, allowlistPath } = {}) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`audit-ci: ${error.message}`)
    return 2
  }

  const { lockPath, threshold, baselinePath } = options
  const audit = await auditLockfile(lockPath, threshold, fetchImpl)
  if (!audit) return 2

  let allowlist
  try {
    allowlist = loadAllowlist(allowlistPath)
  } catch (error) {
    // Fail closed — a broken allowlist must never silently suppress advisories.
    console.error(`audit-ci: could not read allowlist: ${error.message}`)
    return 2
  }
  const { blocking: unallowlisted, suppressed } = partitionAllowlisted(audit.flagged, allowlist)

  let blocking = unallowlisted
  let preexisting = []
  if (baselinePath) {
    const baselineAudit = await auditLockfile(baselinePath, threshold, fetchImpl)
    if (!baselineAudit) return 2
    ;({ introduced: blocking, preexisting } = partitionByBaseline(unallowlisted, baselineAudit.flagged))
  }

  console.log(`audit-ci: scanned ${audit.scanned} packages; threshold=${threshold}+${baselinePath ? `; baseline=${baselinePath}` : ''}`)
  if (suppressed.length > 0) {
    console.log(`audit-ci: ${suppressed.length} advisory(ies) allowlisted:`)
    for (const advisory of suppressed) {
      console.log(`  [${advisory.severity}] ${advisory.name} ${advisory.range} — ${advisory.ghsaId}: ${advisory.reason}`)
    }
  }
  if (preexisting.length > 0) {
    console.log(`audit-ci: ${preexisting.length} advisory(ies) already present in the baseline (not introduced by this change; tracked by .github/workflows/audit.yml):`)
    for (const advisory of preexisting) {
      console.log(`  [${advisory.severity}] ${advisory.name} ${advisory.range} — ${advisory.title} (${advisory.url})`)
    }
  }
  if (blocking.length === 0) {
    console.log(baselinePath ? 'audit-ci: no new advisories at or above threshold.' : 'audit-ci: no advisories at or above threshold.')
    return 0
  }
  console.error(`audit-ci: ${blocking.length} ${baselinePath ? 'new ' : ''}advisory(ies) at or above ${threshold}:`)
  for (const advisory of blocking) {
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
