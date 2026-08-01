#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { deriveKnowledgeChangeClass, validateAuthoredKnowledgeChangeManifest } from './knowledge-change-contract.mjs'

const EXIT_PASS = 0
const EXIT_INVALID = 2
const HASH_PATTERN = /^[a-f0-9]{64}$/
const CHANGE_CONTRACT_RULES = Object.freeze([
  ['routing', /(?:^|\/)(?:AGENTS\.md(?:\.template)?|routing-response\.schema\.json)$/],
  ['skill-link', /(?:^|\/)(?:\.ai|ai)\/skills\/|(?:^|\/)tiers\.json$/],
  ['discovery', /(?:^|\/)(?:generators?|agentic-setup|setup\/tools)\//],
  ['context-read', /(?:^|\/)ai\/harness\/cases\.json$/],
  ['oracle', /(?:^|\/)(?:writable-(?:ast|behavior)-oracles\.mjs|validators\.json)$/],
  ['evaluator', /(?:^|\/)(?:ai\/harness\/.*\.schema\.json|scripts\/(?:evaluate-agent-harness|agent-harness-tool-server|validate-harness-knowledge-change|knowledge-change-contract)\.mjs)$/],
])
const CONTRACT_RANGE_REQUIREMENTS = Object.freeze({
  routing: ['routing.required'],
  'skill-link': ['routing.required'],
  discovery: ['deterministic'],
  'context-read': ['routing.required'],
  evaluator: ['deterministic'],
  oracle: ['writable'],
})

function usage() {
  return 'Usage: node scripts/validate-harness-knowledge-change.mjs --manifest <path> --base <ref>'
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--manifest', '--base'].includes(argument) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`unknown or incomplete argument: ${argument}`)
    const key = argument.slice(2)
    if (result[key]) throw new Error(`duplicate argument: ${argument}`)
    result[key] = argv[index + 1]
    index += 1
  }
  if (!result.manifest || !result.base) throw new Error('both --manifest and --base are required')
  return result
}

function git(root, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    timeout: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? '' },
  })
  if (result.status !== 0 && !options.allowFailure) throw new Error(`git ${args[0]} failed: ${String(result.stderr || result.stdout).trim()}`)
  return result
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hashFile(file) {
  return sha256(fs.readFileSync(file))
}

function readJson(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error(`JSON input must be a bounded regular file: ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false
  return !value.replaceAll('\\', '/').split('/').includes('..')
}

function containedFile(root, relative) {
  if (!safeRelative(relative)) throw new Error(`unsafe repository path: ${relative}`)
  const absolute = path.resolve(root, relative)
  const rootPrefix = `${fs.realpathSync(root)}${path.sep}`
  const real = fs.realpathSync(absolute)
  const stat = fs.lstatSync(absolute)
  if (!real.startsWith(rootPrefix) || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`path must be a contained regular file: ${relative}`)
  return absolute
}

function gitFileHash(root, revision, relative) {
  const result = git(root, ['show', `${revision}:${relative}`], { encoding: null, allowFailure: true })
  return result.status === 0 ? sha256(result.stdout) : null
}

function changedPaths(root, baseSha, headSha) {
  const result = git(root, ['diff', '--name-only', '--diff-filter=ACMRT', '-z', baseSha, headSha], { encoding: null })
  return result.stdout.toString('utf8').split('\0').filter(Boolean).map((entry) => entry.replaceAll('\\', '/'))
}

function changedContractsFor(paths) {
  const result = new Set()
  for (const relative of paths) {
    for (const [contract, matcher] of CHANGE_CONTRACT_RULES) if (matcher.test(relative)) result.add(contract)
  }
  return [...result].sort()
}

function releaseLaneIds(matrix) {
  const result = new Set()
  if (matrix?.deterministic) result.add('deterministic')
  if (matrix?.routing?.required) result.add('routing.required')
  if (matrix?.routing?.portability) result.add('routing.portability')
  if (Array.isArray(matrix?.writable)) result.add('writable')
  if (matrix?.generatedCodeReview) result.add('generated-code-review')
  if (matrix?.generativeJudge) result.add('generative-judge')
  if (matrix?.generatedTests) result.add('generated-tests')
  return result
}

function requiredRangesFor(contracts) {
  return [...new Set(contracts.flatMap((contract) => CONTRACT_RANGE_REQUIREMENTS[contract] ?? []))].sort()
}

function validateCatalogSurfaces(root, manifest, derivedClass, derivedContracts) {
  const harnessRoot = path.join(root, 'packages', 'create-app', 'agentic', 'shared', 'ai', 'harness')
  const fallbackHarnessRoot = path.join(root, '.ai', 'harness')
  const selectedHarnessRoot = fs.existsSync(path.join(harnessRoot, 'cases.json')) ? harnessRoot : fallbackHarnessRoot
  const cases = readJson(path.join(selectedHarnessRoot, 'cases.json'))
  const registry = readJson(path.join(selectedHarnessRoot, 'validators.json'))
  const matrix = readJson(path.join(selectedHarnessRoot, 'release-matrix.json'))
  const errors = []
  if (!Array.isArray(cases)) return { errors: ['cases.json must be an array'], cases: [], registry, matrix }
  if (cases.length !== manifest.expectedCatalogCount) errors.push(`expectedCatalogCount is stale: ${manifest.expectedCatalogCount}/${cases.length}`)
  if (registry?.catalog?.expectedCaseCount !== cases.length) errors.push('validator catalog count differs from cases.json')
  const caseMap = new Map(cases.map((entry) => [entry?.id, entry]))
  if (derivedClass === 'knowledge-contract' && manifest.affectedCaseIds.length === 0) errors.push('knowledge-contract requires at least one affected case')
  for (const caseId of manifest.affectedCaseIds) {
    const item = caseMap.get(caseId)
    if (!item) { errors.push(`affected case does not exist: ${caseId}`); continue }
    for (const validatorId of item.validators ?? []) if (!registry?.validators?.[validatorId]) errors.push(`${caseId} references unknown validator ${validatorId}`)
    if (['implementation', 'regression'].includes(item.evaluationKind)) {
      const oracleIds = item.oracle?.validatorIds ?? []
      if (!oracleIds.length) errors.push(`${caseId} requires mode-specific oracle validators`)
      for (const validatorId of oracleIds) if (registry?.validators?.[validatorId]?.kind !== 'oracle') errors.push(`${caseId} oracle validator is invalid: ${validatorId}`)
      for (const lane of ['writable', 'generated-code-review', 'generative-judge']) {
        if (!manifest.requiredReleaseLanes.includes(lane)) errors.push(`${caseId} requires release lane ${lane}`)
      }
    }
  }
  const lanes = releaseLaneIds(matrix)
  for (const rangeId of manifest.affectedRanges) if (!lanes.has(rangeId)) errors.push(`affected range does not exist: ${rangeId}`)
  for (const lane of manifest.requiredReleaseLanes) if (!lanes.has(lane)) errors.push(`release lane does not exist: ${lane}`)
  if (derivedClass === 'knowledge-contract') {
    for (const rangeId of requiredRangesFor(derivedContracts)) {
      if (!lanes.has(rangeId)) errors.push(`Git-derived range is absent from release-matrix.json: ${rangeId}`)
      if (!manifest.affectedRanges.includes(rangeId)) errors.push(`affectedRanges is missing Git-derived range ${rangeId}`)
      if (!manifest.requiredReleaseLanes.includes(rangeId)) errors.push(`requiredReleaseLanes is missing Git-derived lane ${rangeId}`)
    }
  }
  return { errors, cases, registry, matrix }
}

function deriveChangedItems(root, baseSha, changed, manifest) {
  const generatedByPath = new Map(manifest.generatedFiles.map((entry) => [entry.path, entry]))
  return changed.map((relative) => {
    const generated = generatedByPath.get(relative)
    if (!generated) return { kind: 'authoritative', path: relative }
    const current = containedFile(root, generated.path)
    const source = containedFile(root, generated.sourcePath)
    return {
      kind: 'generated',
      path: generated.path,
      sourcePath: generated.sourcePath,
      baseSourceSha256: gitFileHash(root, baseSha, generated.sourcePath),
      headSourceSha256: hashFile(source),
      sha256: hashFile(current),
      regeneratedSha256: generated.sha256,
    }
  })
}

function validateDeclaredFiles(root, baseSha, changed, manifest) {
  const errors = []
  const authoritativePaths = new Set(manifest.authoritativeFiles.map((entry) => entry.path))
  const declared = new Set([...manifest.authoritativeFiles.map((entry) => entry.path), ...manifest.generatedFiles.map((entry) => entry.path)])
  for (const relative of changed) if (!declared.has(relative)) errors.push(`changed path is not declared: ${relative}`)
  for (const entry of manifest.authoritativeFiles) {
    try {
      const absolute = containedFile(root, entry.path)
      if (hashFile(absolute) !== entry.sha256) errors.push(`authoritative hash is stale: ${entry.path}`)
    } catch (error) { errors.push(error.message) }
  }
  for (const entry of manifest.generatedFiles) {
    try {
      const absolute = containedFile(root, entry.path)
      containedFile(root, entry.sourcePath)
      if (!authoritativePaths.has(entry.sourcePath)) errors.push(`generated sourcePath is not declared authoritative: ${entry.sourcePath}`)
      if (hashFile(absolute) !== entry.sha256) errors.push(`generated hash is stale: ${entry.path}`)
      if (!gitFileHash(root, baseSha, entry.sourcePath)) errors.push(`generated source does not exist at base: ${entry.sourcePath}`)
    } catch (error) { errors.push(error.message) }
  }
  for (const relative of manifest.documentationFiles) {
    try { containedFile(root, relative) } catch (error) { errors.push(error.message) }
  }
  return errors
}

function focusedCommand(relative) {
  if (!safeRelative(relative)) throw new Error(`unsafe focused test path: ${relative}`)
  if (/\.(?:test|spec)\.[cm]?js$/.test(relative)) return [process.execPath, '--test', relative]
  if (/\.(?:test|spec)\.tsx?$/.test(relative)) return [process.execPath, '--import', 'tsx', '--test', relative]
  throw new Error(`focused test must use a fixed Node test filename: ${relative}`)
}

function sanitizeOutput(value, roots) {
  let result = String(value ?? '')
  for (const root of roots.filter(Boolean).sort((left, right) => right.length - left.length)) result = result.split(root).join('<redacted-path>')
  result = result.replace(/[A-Za-z]:[\\/][^\s"']+/g, '<redacted-path>').replace(/\/(?:home|Users|tmp|private\/tmp)\/[^\s"']+/g, '<redacted-path>')
  return result.slice(0, 1024 * 1024)
}

function executeFocused(command, cwd, roots) {
  const run = () => {
    const result = spawnSync(command[0], command.slice(1), {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' },
    })
    const stdout = sanitizeOutput(result.stdout, roots)
    const stderr = sanitizeOutput(result.stderr || result.error?.message, roots)
    return { exitCode: result.status ?? 2, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) }
  }
  const first = run()
  const second = run()
  if (first.exitCode !== second.exitCode) throw new Error(`focused test is flaky: ${command.at(-1)}`)
  return first
}

function collectFocusedEvidence(root, baseSha, manifest) {
  if (manifest.focusedTestFiles.length === 0) throw new Error('knowledge-contract requires at least one focused test file')
  const patchResult = git(root, ['diff', '--binary', baseSha, 'HEAD', '--', ...manifest.focusedTestFiles], { encoding: null })
  if (!patchResult.stdout.length) throw new Error('focused test diff is absent')
  const tempParent = path.join(root, '.ai', 'tmp')
  fs.mkdirSync(tempParent, { recursive: true })
  const tempRoot = fs.mkdtempSync(path.join(tempParent, 'knowledge-change-'))
  const baseRoot = path.join(tempRoot, 'base')
  try {
    git(root, ['worktree', 'add', '--detach', baseRoot, baseSha], { timeout: 60_000 })
    git(baseRoot, ['apply', '--whitespace=nowarn', '-'], { input: patchResult.stdout, encoding: null })
    const evidence = []
    for (const testFile of manifest.focusedTestFiles) {
      containedFile(root, testFile)
      containedFile(baseRoot, testFile)
      const command = focusedCommand(testFile)
      const roots = [root, baseRoot, tempRoot, os.homedir(), os.tmpdir()]
      const baseWithTestPatch = executeFocused(command, baseRoot, roots)
      const head = executeFocused(command, root, roots)
      if (baseWithTestPatch.exitCode === 0) throw new Error(`focused test does not fail on base plus test patch: ${testFile}`)
      if (head.exitCode !== 0) throw new Error(`focused test does not pass at HEAD: ${testFile}`)
      evidence.push({ testFile, command: command.map((entry, index) => index === 0 ? path.basename(entry) : entry), baseWithTestPatch, head })
    }
    return evidence
  } finally {
    git(root, ['worktree', 'remove', '--force', baseRoot], { allowFailure: true, timeout: 60_000 })
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function atomicWrite(file, value) {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true })
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`)
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv)
    const rootProbe = git(process.cwd(), ['rev-parse', '--show-toplevel'])
    const root = fs.realpathSync(rootProbe.stdout.trim())
    const manifestPath = path.resolve(process.cwd(), options.manifest)
    const manifest = readJson(manifestPath)
    const manifestErrors = validateAuthoredKnowledgeChangeManifest(manifest)
    if (manifestErrors.length) throw new Error(manifestErrors.join('; '))
    if (manifest.baseRef !== options.base) throw new Error('authored baseRef must exactly match --base')
    const status = git(root, ['status', '--porcelain', '--untracked-files=all']).stdout.trim()
    if (status) throw new Error('HEAD worktree must be committed and clean')
    const baseSha = git(root, ['rev-parse', '--verify', `${options.base}^{commit}`]).stdout.trim()
    const headSha = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim()
    if (![baseSha, headSha].every((value) => /^[a-f0-9]{40}$/.test(value))) throw new Error('resolved Git SHAs are invalid')
    if (git(root, ['merge-base', '--is-ancestor', baseSha, headSha], { allowFailure: true }).status !== 0) throw new Error('--base must be an ancestor of HEAD')
    const changed = changedPaths(root, baseSha, headSha)
    if (changed.length === 0) throw new Error('base-to-HEAD diff is empty')
    const declaredFileErrors = validateDeclaredFiles(root, baseSha, changed, manifest)
    const derivedContracts = changedContractsFor(changed)
    if (JSON.stringify([...manifest.changedContracts].sort()) !== JSON.stringify(derivedContracts)) {
      declaredFileErrors.push(`changedContracts differs from Git-derived contracts: ${manifest.changedContracts.join(',') || '<none>'}/${derivedContracts.join(',') || '<none>'}`)
    }
    const changedItems = deriveChangedItems(root, baseSha, changed, manifest)
    const derivedClass = deriveKnowledgeChangeClass({ changedItems })
    if (manifest.changeClass !== derivedClass) declaredFileErrors.push(`declared changeClass differs from Git-derived class: ${manifest.changeClass}/${derivedClass}`)
    const catalog = validateCatalogSurfaces(root, manifest, derivedClass, derivedContracts)
    const errors = [...catalog.errors, ...declaredFileErrors]
    if (errors.length) throw new Error(errors.join('; '))
    const focusedExecutions = derivedClass === 'knowledge-contract' ? collectFocusedEvidence(root, baseSha, manifest) : []
    const completed = { ...manifest, resolvedBaseSha: baseSha, headSha, focusedExecutions }
    atomicWrite(manifestPath, completed)
    console.log(`PASS knowledge change manifest — ${derivedClass}`)
    return EXIT_PASS
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage())
    return EXIT_INVALID
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main()
