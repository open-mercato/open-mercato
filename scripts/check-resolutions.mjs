#!/usr/bin/env node
/**
 * Dead-resolution-key checker.
 *
 * A `resolutions` key that carries a range — `undici@npm:^8.4.1` rather than plain
 * `undici` — only applies while that exact descriptor is requested somewhere in the
 * tree. When the requester bumps its declared range the key stops matching, and Yarn
 * says nothing about a resolution that matches nothing: the pin silently stops
 * applying and the dependency floats back up. Every security pin expressed that way
 * can therefore rot invisibly, and the first sign is a red audit job with nothing in
 * the diff to explain it (#5098).
 *
 * This script walks the root manifest's `resolutions` map and fails when a
 * range-carrying key matches no descriptor requested anywhere in `yarn.lock`.
 *
 * What counts as "requested": the `dependencies`, `devDependencies` and
 * `optionalDependencies` maps of every lockfile entry — those are the descriptors
 * Yarn actually resolves, and a resolution rewrites the resolved version without
 * rewriting the requester's declared range, so a live key still appears there.
 * Lockfile entry keys are deliberately NOT counted: after a resolution applies, the
 * entry is keyed by the pin's target, so accepting entry keys would let a key that
 * points at its own target look alive while matching no real requester.
 * `peerDependencies` are excluded too — Yarn satisfies those from the ancestor tree
 * instead of resolving them as descriptors of their own, so a resolution keyed on a
 * peer range applies to nothing.
 *
 * Usage:
 *   node scripts/check-resolutions.mjs             # check (exit 1 on failure)
 *   node scripts/check-resolutions.mjs --json      # machine-readable report
 *   node scripts/check-resolutions.mjs --root <dir># check another checkout
 *
 * Yarn shortcut: `yarn check:resolutions`
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..')
const MANIFEST_FILE = 'package.json'
const LOCKFILE = 'yarn.lock'
const REQUEST_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies']

const USAGE = `Usage: node scripts/check-resolutions.mjs [--root <dir>] [--json]

Fails when a range-carrying "resolutions" key in the root package.json matches no
descriptor requested in yarn.lock, which is how Yarn silently drops a pin.`

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, json: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--root requires a directory path')
      options.root = path.resolve(value)
      index += 1
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

/**
 * Yarn resolution keys are `[<ancestor-descriptor>/]<descriptor>`. Only the trailing
 * descriptor decides whether the key can match anything at all, so the optional
 * ancestor half is dropped here — a key whose descriptor is absent from the tree is
 * dead no matter which ancestor it was meant to narrow.
 */
function resolutionDescriptor(key) {
  const scopeEnd = key.startsWith('@') ? key.indexOf('/') : -1
  const separator = key.indexOf('/', scopeEnd + 1)
  return separator === -1 ? key : key.slice(separator + 1)
}

function splitIdentifierAndRange(descriptor) {
  const scopeEnd = descriptor.startsWith('@') ? descriptor.indexOf('/') : -1
  if (descriptor.startsWith('@') && scopeEnd === -1) return { identifier: descriptor, range: null }
  const separator = descriptor.indexOf('@', scopeEnd + 1)
  if (separator === -1) return { identifier: descriptor, range: null }
  return { identifier: descriptor.slice(0, separator), range: descriptor.slice(separator + 1) }
}

/** A range written without a protocol means the npm protocol, so both spellings match. */
function descriptorSpellings(identifier, range) {
  const spellings = [`${identifier}@${range}`]
  if (!range.includes(':')) spellings.push(`${identifier}@npm:${range}`)
  return spellings
}

function readManifest(root) {
  const manifestPath = path.join(root, MANIFEST_FILE)
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing ${MANIFEST_FILE} in ${root}`)
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function collectRequestedDescriptors(root) {
  const lockfilePath = path.join(root, LOCKFILE)
  if (!fs.existsSync(lockfilePath)) throw new Error(`Missing ${LOCKFILE} in ${root}`)
  const document = YAML.parse(fs.readFileSync(lockfilePath, 'utf8')) ?? {}
  const requesters = new Map()
  const rangesByIdentifier = new Map()
  for (const [entryKey, entry] of Object.entries(document)) {
    if (entryKey === '__metadata' || !entry || typeof entry !== 'object') continue
    const requester = typeof entry.resolution === 'string' ? entry.resolution : entryKey
    for (const field of REQUEST_FIELDS) {
      const requested = entry[field]
      if (!requested || typeof requested !== 'object') continue
      for (const [identifier, range] of Object.entries(requested)) {
        const descriptor = `${identifier}@${range}`
        if (!requesters.has(descriptor)) requesters.set(descriptor, new Set())
        requesters.get(descriptor).add(requester)
        if (!rangesByIdentifier.has(identifier)) rangesByIdentifier.set(identifier, new Set())
        rangesByIdentifier.get(identifier).add(String(range))
      }
    }
  }
  return { requesters, rangesByIdentifier }
}

function inspectResolutions(root) {
  const manifest = readManifest(root)
  const resolutions = manifest.resolutions ?? {}
  const { requesters, rangesByIdentifier } = collectRequestedDescriptors(root)
  const live = []
  const wildcard = []
  const dead = []
  for (const [key, target] of Object.entries(resolutions)) {
    const { identifier, range } = splitIdentifierAndRange(resolutionDescriptor(key))
    if (!range) {
      wildcard.push({ key, target, identifier })
      continue
    }
    const matched = descriptorSpellings(identifier, range).find((spelling) => requesters.has(spelling))
    if (matched) {
      live.push({ key, target, identifier, requestedBy: [...requesters.get(matched)].sort() })
      continue
    }
    dead.push({
      key,
      target,
      identifier,
      requestedRanges: [...(rangesByIdentifier.get(identifier) ?? [])].sort(),
    })
  }
  return { live, wildcard, dead }
}

function formatFailure({ dead }) {
  const lines = [
    `${dead.length} descriptor-keyed ${dead.length === 1 ? 'resolution matches' : 'resolutions match'} nothing in ${LOCKFILE}.`,
    'Yarn ignores a resolution whose descriptor is not requested anywhere, so these pins',
    'are not applying and the packages they name are floating free:',
    '',
  ]
  for (const entry of dead) {
    lines.push(`  "${entry.key}": ${JSON.stringify(entry.target)}`)
    lines.push(`      nothing in ${LOCKFILE} requests ${resolutionDescriptor(entry.key)}`)
    lines.push(
      entry.requestedRanges.length
        ? `      ${entry.identifier} ranges actually requested: ${entry.requestedRanges.join(', ')}`
        : `      ${entry.identifier} is not requested by anything — the pin can be dropped`,
    )
    lines.push('')
  }
  lines.push('Re-key each one to a range that is actually requested, or delete it when the pin is')
  lines.push('no longer needed. Where the requester is one of our own workspace packages, bump')
  lines.push('that package\'s dependency range instead — a direct range cannot rot this way.')
  return lines.join('\n')
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    console.error(USAGE)
    process.exit(1)
  }
  if (options.help) {
    console.log(USAGE)
    return
  }

  let report
  try {
    report = inspectResolutions(options.root)
  } catch (error) {
    console.error(`check-resolutions: ${error.message}`)
    process.exit(1)
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    process.exit(report.dead.length > 0 ? 1 : 0)
  }

  if (report.dead.length > 0) {
    console.error(formatFailure(report))
    process.exit(1)
  }

  console.log(
    `check-resolutions: ${report.live.length} descriptor-keyed resolutions all match a descriptor in ${LOCKFILE}` +
      ` (${report.wildcard.length} range-less keys apply to every descriptor and cannot rot).`,
  )
}

main()
