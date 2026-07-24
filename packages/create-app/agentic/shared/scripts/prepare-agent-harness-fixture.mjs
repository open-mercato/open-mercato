#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function isWithin(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function usage() {
  return `Prepare one declared writable agent-harness fixture in a separate disposable app.

Usage:
  node scripts/prepare-agent-harness-fixture.mjs --case OMH-NNN --target /absolute/app --acknowledge-writes

The target must be a fresh standalone scaffold. Existing fixture files are never overwritten.`
}

function parseArgs(argv) {
  const options = { caseId: undefined, target: undefined, acknowledgeWrites: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`)
      index += 1
      return next
    }
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--case') options.caseId = value()
    else if (arg === '--target') options.target = value()
    else if (arg === '--acknowledge-writes') options.acknowledgeWrites = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(controllerRoot, relative), 'utf8'))
}

function isSafeRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\0')) return false
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
  return normalized !== '..' && !normalized.startsWith('../')
}

function assertFreshStandaloneTarget(target) {
  if (isWithin(controllerRoot, target) || target === path.parse(target).root) throw new Error('--target must be outside the controller app')
  for (const required of ['package.json', 'src/modules.ts', '.ai/harness/cases.json']) {
    if (!fs.existsSync(path.join(target, required))) throw new Error(`target is not a generated standalone app: missing ${required}`)
  }
  if (fs.existsSync(path.join(target, '.ai', 'harness', 'DISPOSABLE'))) throw new Error('target is already prepared; use a fresh scaffold')
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return 0
  }
  if (!options.caseId || !options.target || !options.acknowledgeWrites) {
    throw new Error('--case, --target, and --acknowledge-writes are required')
  }

  if (!path.isAbsolute(options.target)) throw new Error('--target must be absolute')
  const target = fs.realpathSync(options.target)
  assertFreshStandaloneTarget(target)
  const cases = readJson('.ai/harness/cases.json')
  const fixtures = readJson('.ai/harness/fixtures/index.json')
  const seeds = readJson('.ai/harness/fixtures/seeds.json')
  const caseRecord = cases.find((entry) => entry.id === options.caseId)
  if (!caseRecord || !['implementation', 'regression'].includes(caseRecord.evaluationKind)) {
    throw new Error(`${options.caseId} is not a writable harness case`)
  }

  const declarations = caseRecord.fixture?.setup ?? []
  if (declarations.length !== 1 || !declarations[0].startsWith('fixture:')) throw new Error(`${options.caseId} has an invalid fixture declaration`)
  const fixtureId = declarations[0].slice('fixture:'.length)
  const fixture = fixtures.fixtures?.[fixtureId]
  const files = seeds.fixtures?.[fixtureId]
  if (!fixture || !files) throw new Error(`fixture seed is unavailable: ${fixtureId}`)
  const paths = Object.keys(files)
  if (paths.some((entry) => !isSafeRelative(entry))) throw new Error(`fixture contains an unsafe path: ${fixtureId}`)
  if (JSON.stringify([...paths].sort()) !== JSON.stringify([...fixture.seededArtifacts].sort())) {
    throw new Error(`fixture seed paths do not match the declared artifacts: ${fixtureId}`)
  }
  if (paths.some((entry) => !caseRecord.allowedWrites.some((allowed) => allowed === entry || (allowed.endsWith('/**') && entry.startsWith(allowed.slice(0, -2)))))) {
    throw new Error(`fixture seed escapes the case write allowlist: ${fixtureId}`)
  }
  const existing = paths.filter((entry) => fs.existsSync(path.join(target, entry)))
  if (existing.length) throw new Error(`fixture would overwrite existing files: ${existing.join(', ')}`)

  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(target, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o644 })
  }
  const marker = path.join(target, '.ai', 'harness', 'DISPOSABLE')
  fs.writeFileSync(marker, `${JSON.stringify({ schemaVersion: 1, caseId: options.caseId, fixtureId }, null, 2)}\n`, { mode: 0o600 })
  console.log(`Prepared ${options.caseId} (${fixtureId}) in ${target}`)
  console.log(`Run: yarn harness:validate --runner <codex|claude> --case ${options.caseId} --writable-root ${target} --acknowledge-writes`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 2
}
