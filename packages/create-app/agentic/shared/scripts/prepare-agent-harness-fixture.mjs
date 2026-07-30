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

function lstatIfPresent(candidate) {
  try {
    return fs.lstatSync(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function assertDirectory(root, candidate, label) {
  const lexical = path.resolve(candidate)
  if (!isWithin(root, lexical)) throw new Error(`${label} escapes the target app`)
  const stat = lstatIfPresent(lexical)
  if (!stat) return false
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`)
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory`)
  const real = fs.realpathSync(lexical)
  if (!isWithin(root, real)) throw new Error(`${label} resolves outside the target app`)
  return true
}

function ensureDirectoryChain(root, relativeDirectory, create) {
  if (!isSafeRelative(relativeDirectory) && relativeDirectory !== '.') {
    throw new Error(`unsafe fixture parent path: ${relativeDirectory}`)
  }
  assertDirectory(root, root, 'target root')
  if (relativeDirectory === '.') return

  let cursor = root
  for (const component of relativeDirectory.replaceAll('\\', '/').split('/').filter(Boolean)) {
    cursor = path.join(cursor, component)
    if (assertDirectory(root, cursor, `fixture parent ${path.relative(root, cursor)}`)) continue
    if (!create) throw new Error(`fixture parent is missing: ${path.relative(root, cursor)}`)
    try {
      fs.mkdirSync(cursor, { mode: 0o755 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    if (!assertDirectory(root, cursor, `fixture parent ${path.relative(root, cursor)}`)) {
      throw new Error(`failed to create fixture parent: ${path.relative(root, cursor)}`)
    }
  }
}

function assertSafeDestination(root, relativeFile) {
  const destination = path.resolve(root, relativeFile)
  if (!isWithin(root, destination)) throw new Error(`fixture destination escapes the target app: ${relativeFile}`)
  assertDirectory(root, root, 'target root')

  let cursor = root
  for (const component of path.dirname(relativeFile).replaceAll('\\', '/').split('/').filter((entry) => entry && entry !== '.')) {
    cursor = path.join(cursor, component)
    const stat = lstatIfPresent(cursor)
    if (!stat) return
    assertDirectory(root, cursor, `fixture parent ${path.relative(root, cursor)}`)
  }
}

function assertRegularFile(root, relativeFile, label) {
  ensureDirectoryChain(root, path.dirname(relativeFile), false)
  const candidate = path.join(root, relativeFile)
  const stat = lstatIfPresent(candidate)
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`)
  const real = fs.realpathSync(candidate)
  if (!isWithin(root, real)) throw new Error(`${label} resolves outside the target app`)
}

function createFile(root, relativeFile, content, mode) {
  ensureDirectoryChain(root, path.dirname(relativeFile), true)
  const destination = path.join(root, relativeFile)
  if (!isWithin(root, path.resolve(destination))) throw new Error(`fixture destination escapes the target app: ${relativeFile}`)
  const flags = fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | fs.constants.O_WRONLY
    | (fs.constants.O_NOFOLLOW ?? 0)
  let descriptor
  try {
    descriptor = fs.openSync(destination, flags, mode)
    fs.writeFileSync(descriptor, content)
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw new Error(`fixture would overwrite existing files: ${relativeFile}`)
    }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }

  const stat = fs.lstatSync(destination)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`fixture destination is not a regular file: ${relativeFile}`)
  const real = fs.realpathSync(destination)
  if (!isWithin(root, real)) throw new Error(`fixture destination resolves outside the target app: ${relativeFile}`)
}

function assertFreshStandaloneTarget(target) {
  if (isWithin(controllerRoot, target) || target === path.parse(target).root) throw new Error('--target must be outside the controller app')
  for (const required of ['package.json', 'src/modules.ts', '.ai/harness/cases.json']) {
    try {
      assertRegularFile(target, required, `standalone marker ${required}`)
    } catch {
      throw new Error(`target is not a generated standalone app: missing or unsafe ${required}`)
    }
  }
  if (lstatIfPresent(path.join(target, '.ai', 'harness', 'DISPOSABLE'))) throw new Error('target is already prepared; use a fresh scaffold')
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
  const lexicalTarget = path.resolve(options.target)
  const targetStat = fs.lstatSync(lexicalTarget)
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new Error('--target must be a regular directory, not a symbolic link')
  const target = fs.realpathSync(lexicalTarget)
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
  for (const relative of [...paths, '.ai/harness/DISPOSABLE']) assertSafeDestination(target, relative)
  const existing = paths.filter((entry) => lstatIfPresent(path.join(target, entry)))
  if (existing.length) throw new Error(`fixture would overwrite existing files: ${existing.join(', ')}`)

  for (const [relative, content] of Object.entries(files)) {
    createFile(target, relative, content.endsWith('\n') ? content : `${content}\n`, 0o644)
  }
  createFile(
    target,
    '.ai/harness/DISPOSABLE',
    `${JSON.stringify({ schemaVersion: 1, caseId: options.caseId, fixtureId }, null, 2)}\n`,
    0o600,
  )
  console.log(`Prepared ${options.caseId} (${fixtureId}) in ${target}`)
  console.log('Before validation, run `yarn generate` in the target and link its node_modules to the controller dependency tree.')
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
