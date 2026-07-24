#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const WRITABLE_KINDS = new Set(['implementation', 'regression'])
const RUNNERS = new Set(['codex', 'claude'])
const ALLOWED_VALIDATION_COMMANDS = new Set(['yarn generate', 'yarn typecheck', 'yarn lint', 'yarn build'])
const RESULT_LIMIT = 262_144
const ERROR_LIMIT = 2_000
const VIOLATION_LIMIT = 300

function usage() {
  return `Run the complete standalone agent-harness release gate.

Usage:
  yarn harness:release --writable-targets /absolute/release-targets.json --acknowledge-writes

Options:
  --root <absolute-app>          Controller/generated app root (default: current directory)
  --writable-targets <absolute> JSON map of every writable case to a fresh disposable app
  --case-timeout <ms>           Per-model invocation timeout (default: 120000)
  --validation-timeout <ms>     Timeout for each yarn validation (default: 1800000)
  --acknowledge-writes          Required: fixture preparation and validation commands write files
  --help                        Show this help

The command preflights complete matrix, fixture, review, and target coverage before
running deterministic validation, configured live routing, writable trusted-oracle
gates, explicit om-code-review, and the release-matrix validation commands. It stores
only a sanitized aggregate report under .ai/harness/results/.`
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    writableTargets: undefined,
    caseTimeout: 120_000,
    validationTimeout: 1_800_000,
    acknowledgeWrites: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      index += 1
      if (index >= argv.length) throw new Error(`${arg} requires a value`)
      return argv[index]
    }
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--root') options.root = value()
    else if (arg === '--writable-targets') options.writableTargets = value()
    else if (arg === '--case-timeout') options.caseTimeout = Number(value())
    else if (arg === '--validation-timeout') options.validationTimeout = Number(value())
    else if (arg === '--acknowledge-writes') options.acknowledgeWrites = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (options.help) return options
  if (!path.isAbsolute(options.root)) throw new Error('--root must be an absolute path')
  if (!options.writableTargets || !path.isAbsolute(options.writableTargets)) throw new Error('--writable-targets must be an absolute path')
  if (!options.acknowledgeWrites) throw new Error('the full release gate requires --acknowledge-writes')
  if (!Number.isInteger(options.caseTimeout) || options.caseTimeout < 1_000 || options.caseTimeout > 3_600_000) throw new Error('--case-timeout must be from 1000 to 3600000 milliseconds')
  if (!Number.isInteger(options.validationTimeout) || options.validationTimeout < 1_000 || options.validationTimeout > 7_200_000) throw new Error('--validation-timeout must be from 1000 to 7200000 milliseconds')
  return options
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function difference(left, right) {
  const rightSet = new Set(right)
  return sortedUnique(left.filter((value) => !rightSet.has(value)))
}

function duplicates(values) {
  const seen = new Set()
  const repeated = new Set()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated].sort()
}

function resolveCaseSelector(selector, allCaseIds) {
  if (selector === 'all') return [...allCaseIds]
  return Array.isArray(selector) ? [...selector] : []
}

function addCoverageViolation(violations, label, ids) {
  if (ids.length) violations.push(`${label}: ${ids.join(', ')}`)
}

function validTargetsManifest(targetsManifest) {
  return targetsManifest?.schemaVersion === 1 && targetsManifest?.targets && typeof targetsManifest.targets === 'object' && !Array.isArray(targetsManifest.targets)
}

export function buildReleasePlan({ cases, registry, releaseMatrix, fixtures, seeds, targetsManifest, root }) {
  const allCaseIds = cases.map((item) => item.id)
  const writableCases = cases.filter((item) => WRITABLE_KINDS.has(item.evaluationKind))
  const writableCaseIds = writableCases.map((item) => item.id)
  const reviewEligibleCaseIds = cases
    .filter((item) => item.evaluationKind === 'implementation' && item.mode === 'one-shot')
    .map((item) => item.id)
  const violations = []
  const release = releaseMatrix?.releaseSuite ?? {}
  const deterministicIds = resolveCaseSelector(releaseMatrix?.deterministic?.caseIds, allCaseIds)
  const deterministicMissingCaseIds = difference(allCaseIds, deterministicIds)
  const deterministicUnexpectedCaseIds = difference(deterministicIds, allCaseIds)
  addCoverageViolation(violations, 'deterministic matrix is missing cases', deterministicMissingCaseIds)
  addCoverageViolation(violations, 'deterministic matrix contains unknown cases', deterministicUnexpectedCaseIds)

  const routing = []
  const routingRunners = Array.isArray(release.routingRunners) ? release.routingRunners : []
  for (const runner of routingRunners) {
    const expectedCaseIds = resolveCaseSelector(releaseMatrix?.routing?.[runner]?.caseIds, allCaseIds)
    const unknownCaseIds = difference(expectedCaseIds, allCaseIds)
    if (!RUNNERS.has(runner)) violations.push(`release routing runner is invalid: ${String(runner)}`)
    if (typeof releaseMatrix?.routing?.[runner]?.modelSelector !== 'string') violations.push(`release routing runner lacks a model selector: ${String(runner)}`)
    addCoverageViolation(violations, `${runner} routing matrix contains unknown cases`, unknownCaseIds)
    routing.push({ runner, expectedCaseIds, unknownCaseIds })
  }
  if (routingRunners.length === 0) violations.push('release suite must declare at least one routing runner')
  if (difference(allCaseIds, sortedUnique(routing.flatMap((entry) => entry.expectedCaseIds))).length) {
    addCoverageViolation(violations, 'live routing has no runner coverage for cases', difference(allCaseIds, sortedUnique(routing.flatMap((entry) => entry.expectedCaseIds))))
  }

  const writableEntries = Array.isArray(releaseMatrix?.writable) ? releaseMatrix.writable : []
  const assignedWritableIds = writableEntries.map((entry) => entry.caseId)
  const missingWritableMatrixCaseIds = difference(writableCaseIds, assignedWritableIds)
  const unexpectedWritableMatrixCaseIds = difference(assignedWritableIds, writableCaseIds)
  const duplicateWritableMatrixCaseIds = duplicates(assignedWritableIds)
  addCoverageViolation(violations, 'writable release matrix is missing cases', missingWritableMatrixCaseIds)
  addCoverageViolation(violations, 'writable release matrix contains non-writable cases', unexpectedWritableMatrixCaseIds)
  addCoverageViolation(violations, 'writable release matrix contains duplicate cases', duplicateWritableMatrixCaseIds)
  for (const entry of writableEntries) {
    if (!RUNNERS.has(entry.runner) || typeof entry.modelSelector !== 'string') violations.push(`writable release assignment is invalid: ${String(entry.caseId)}`)
  }

  const configuredReviewIds = Array.isArray(releaseMatrix?.generatedCodeReview?.caseIds)
    ? releaseMatrix.generatedCodeReview.caseIds
    : []
  const missingReviewMatrixCaseIds = difference(reviewEligibleCaseIds, configuredReviewIds)
  const unexpectedReviewMatrixCaseIds = difference(configuredReviewIds, reviewEligibleCaseIds)
  addCoverageViolation(violations, 'generated-code review matrix is missing eligible cases', missingReviewMatrixCaseIds)
  addCoverageViolation(violations, 'generated-code review matrix contains ineligible cases', unexpectedReviewMatrixCaseIds)
  if (release.requireGeneratedCodeReview !== true) violations.push('release suite must require generated-code review')
  if (releaseMatrix?.generatedCodeReview?.skill !== 'om-code-review') violations.push('generated-code review must explicitly use om-code-review')
  const reviewSkillFiles = [
    '.agents/skills/om-code-review/SKILL.md',
    '.agents/skills/om-code-review/references/agentic-setup.md',
    '.agents/skills/om-code-review/references/output-format.md',
    '.agents/skills/om-code-review/references/review-checklist.md',
    '.agents/skills/om-code-review/references/rules.md',
    '.agents/skills/.om-external-ownership.json',
  ]
  const reviewSkillReady = !root || reviewSkillFiles.every((relative) => fs.existsSync(path.join(root, relative)))
  if (!reviewSkillReady) violations.push('generated-code review skill is not installed with ownership evidence')

  const registryCaseCountMatches = registry?.catalog?.expectedCaseCount === cases.length
  if (!registryCaseCountMatches) violations.push(`validator registry expects ${String(registry?.catalog?.expectedCaseCount)} cases but catalog contains ${cases.length}`)
  const registryWritableIds = Array.isArray(registry?.catalog?.writableCaseIds) ? registry.catalog.writableCaseIds : []
  const registryMissingWritableCaseIds = difference(writableCaseIds, registryWritableIds)
  const registryUnexpectedWritableCaseIds = difference(registryWritableIds, writableCaseIds)
  addCoverageViolation(violations, 'validator registry is missing writable cases', registryMissingWritableCaseIds)
  addCoverageViolation(violations, 'validator registry contains non-writable cases', registryUnexpectedWritableCaseIds)

  const missingFixtureCaseIds = []
  const missingOracleCaseIds = []
  for (const item of writableCases) {
    const setupEntries = Array.isArray(item.fixture?.setup) ? item.fixture.setup : []
    const setupIds = setupEntries
      .filter((entry) => typeof entry === 'string' && /^fixture:[a-z0-9-]+$/.test(entry))
      .map((entry) => entry.slice('fixture:'.length))
    const fixtureComplete = item.fixture?.scaffold === 'fresh-standalone'
      && setupIds.length > 0
      && setupIds.length === setupEntries.length
      && setupIds.every((id) => fixtures?.fixtures?.[id] && seeds?.fixtures?.[id])
    if (!fixtureComplete) missingFixtureCaseIds.push(item.id)
    const oracleIds = Array.isArray(item.oracle?.validatorIds) ? item.oracle.validatorIds : []
    const oracleComplete = oracleIds.some((id) => {
      const declaration = registry?.validators?.[id]
      return declaration?.implementation === 'trusted-executable' && Array.isArray(declaration.runners) && declaration.runners.length > 0
    }) && Array.isArray(item.oracle?.expectedArtifacts) && item.oracle.expectedArtifacts.length > 0
    if (!oracleComplete) missingOracleCaseIds.push(item.id)
  }
  addCoverageViolation(violations, 'writable cases lack complete fixture coverage', missingFixtureCaseIds)
  addCoverageViolation(violations, 'writable cases lack trusted oracle coverage', missingOracleCaseIds)

  const targetEntries = validTargetsManifest(targetsManifest) ? targetsManifest.targets : {}
  if (!validTargetsManifest(targetsManifest)) violations.push('writable target manifest must use schemaVersion 1 and a targets object')
  const targetIds = Object.keys(targetEntries)
  const missingTargetCaseIds = writableCaseIds.filter((id) => typeof targetEntries[id] !== 'string' || !path.isAbsolute(targetEntries[id]))
  const unexpectedTargetCaseIds = difference(targetIds, writableCaseIds)
  const duplicateTargetCaseIds = []
  const invalidTargetCaseIds = []
  const targetOwners = new Map()
  for (const id of writableCaseIds) {
    const target = targetEntries[id]
    if (typeof target !== 'string' || !path.isAbsolute(target)) continue
    let normalized = path.resolve(target)
    if (root) {
      try {
        const stat = fs.lstatSync(target)
        normalized = fs.realpathSync(target)
        const required = ['package.json', 'src/modules.ts', '.ai/harness/cases.json']
        if (!stat.isDirectory() || stat.isSymbolicLink() || normalized === root
          || required.some((relative) => !fs.existsSync(path.join(normalized, relative)))
          || fs.existsSync(path.join(normalized, '.ai', 'harness', 'DISPOSABLE'))) invalidTargetCaseIds.push(id)
      } catch { invalidTargetCaseIds.push(id) }
    }
    if (targetOwners.has(normalized)) duplicateTargetCaseIds.push(id, targetOwners.get(normalized))
    else targetOwners.set(normalized, id)
  }
  addCoverageViolation(violations, 'writable target manifest is missing absolute targets', sortedUnique(missingTargetCaseIds))
  addCoverageViolation(violations, 'writable target manifest contains unknown cases', unexpectedTargetCaseIds)
  addCoverageViolation(violations, 'writable target manifest reuses targets', sortedUnique(duplicateTargetCaseIds))
  addCoverageViolation(violations, 'writable target manifest contains invalid or reused app roots', sortedUnique(invalidTargetCaseIds))

  const validationCommands = Array.isArray(release.validationCommands) ? release.validationCommands : []
  if (validationCommands.length === 0) violations.push('release suite must declare validation commands')
  for (const command of validationCommands) {
    if (!ALLOWED_VALIDATION_COMMANDS.has(command)) violations.push(`release validation command is not allowed: ${String(command)}`)
  }
  const missingValidationCommands = difference([...ALLOWED_VALIDATION_COMMANDS], validationCommands)
  addCoverageViolation(violations, 'release suite is missing validation commands', missingValidationCommands)

  const steps = [
    { id: 'deterministic:all', kind: 'deterministic', expectedCaseIds: deterministicIds },
    ...validationCommands.map((command) => ({ id: `validation:${command.slice('yarn '.length)}`, kind: 'validation', command })),
    ...routing.map((entry) => ({ id: `routing:${entry.runner}`, kind: 'routing', runner: entry.runner, expectedCaseIds: entry.expectedCaseIds })),
  ]
  for (const caseId of writableCaseIds) {
    const assignment = writableEntries.find((entry) => entry.caseId === caseId)
    if (!assignment) continue
    steps.push({ id: `fixture:${caseId}`, kind: 'fixture', caseId })
    steps.push({ id: `writable:${caseId}`, kind: 'writable', caseId, runner: assignment.runner, modelSelector: assignment.modelSelector })
    if (configuredReviewIds.includes(caseId)) {
      const modelSelector = releaseMatrix.generatedCodeReview?.runners?.[assignment.runner]?.modelSelector
      if (typeof modelSelector !== 'string') violations.push(`generated-code review lacks ${assignment.runner} model selector for ${caseId}`)
      steps.push({ id: `review:${caseId}`, kind: 'review', caseId, runner: assignment.runner, modelSelector })
    }
  }

  return {
    catalog: {
      caseCount: cases.length,
      writableCaseCount: writableCaseIds.length,
      reviewEligibleCaseCount: reviewEligibleCaseIds.length,
    },
    coverage: {
      deterministic: { expectedCaseIds: allCaseIds, configuredCaseIds: deterministicIds, missingMatrixCaseIds: deterministicMissingCaseIds, unexpectedMatrixCaseIds: deterministicUnexpectedCaseIds },
      routing,
      writable: {
        expectedCaseIds: writableCaseIds,
        configuredCaseIds: assignedWritableIds,
        missingMatrixCaseIds: missingWritableMatrixCaseIds,
        unexpectedMatrixCaseIds: unexpectedWritableMatrixCaseIds,
        duplicateMatrixCaseIds: duplicateWritableMatrixCaseIds,
        missingTargetCaseIds: sortedUnique(missingTargetCaseIds),
        unexpectedTargetCaseIds,
        duplicateTargetCaseIds: sortedUnique(duplicateTargetCaseIds),
        invalidTargetCaseIds: sortedUnique(invalidTargetCaseIds),
        missingFixtureCaseIds: sortedUnique(missingFixtureCaseIds),
        missingOracleCaseIds: sortedUnique(missingOracleCaseIds),
      },
      review: { expectedCaseIds: reviewEligibleCaseIds, configuredCaseIds: configuredReviewIds, missingMatrixCaseIds: missingReviewMatrixCaseIds, unexpectedMatrixCaseIds: unexpectedReviewMatrixCaseIds, skillReady: reviewSkillReady },
      registry: { caseCountMatches: registryCaseCountMatches, missingWritableCaseIds: registryMissingWritableCaseIds, unexpectedWritableCaseIds: registryUnexpectedWritableCaseIds },
      validation: { expectedCommands: [...ALLOWED_VALIDATION_COMMANDS], configuredCommands: validationCommands, missingCommands: missingValidationCommands },
    },
    targets: targetEntries,
    steps,
    violations: sortedUnique(violations),
  }
}

function percentage(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100
}

function percentile(values, value) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]
}

function violationCategory(value) {
  const text = String(value)
  if (/forbidden|unsafe|out-of-root|outside allowlist|protected roots|inspection|modified (?:target|bundle)|trace unavailable|no observed context/i.test(text)) return 'safety'
  if (/route|skill|context|decision|pattern|budget|missing|required|unexpected|mismatch/i.test(text)) return 'contract'
  if (/process|environment|structured output|timed out|runner/i.test(text)) return 'execution'
  return 'quality'
}

export function aggregateQualityMetrics(results) {
  const contextTokens = []
  const initialContextTokens = []
  let passed = 0
  let corrections = 0
  let resultsWithCorrections = 0
  let firstPassPassed = 0
  let totalViolations = 0
  let resultsWithViolations = 0
  const violationsByCategory = { safety: 0, contract: 0, execution: 0, quality: 0 }
  const verdicts = { approve: 0, requestChanges: 0, error: 0 }
  for (const result of results) {
    if (result.status === 'pass') passed += 1
    const resultCorrections = Number.isInteger(result.corrections) ? result.corrections : Math.max(0, (result.attempts ?? 1) - 1)
    corrections += resultCorrections
    if (resultCorrections > 0) resultsWithCorrections += 1
    if (result.status === 'pass' && resultCorrections === 0) firstPassPassed += 1
    if (Number.isInteger(result.actualContext?.estimatedTokens)) contextTokens.push(result.actualContext.estimatedTokens)
    if (Number.isInteger(result.actualContext?.estimatedInitialTokens)) initialContextTokens.push(result.actualContext.estimatedInitialTokens)
    const resultViolations = Array.isArray(result.violations) ? result.violations : []
    if (resultViolations.length) resultsWithViolations += 1
    totalViolations += resultViolations.length
    for (const violation of resultViolations) violationsByCategory[violationCategory(violation)] += 1
    if (result.verdict === 'approve') verdicts.approve += 1
    else if (result.verdict === 'request changes') verdicts.requestChanges += 1
    else if (result.verdict === 'error') verdicts.error += 1
  }
  const totalContextTokens = contextTokens.reduce((sum, value) => sum + value, 0)
  const totalInitialContextTokens = initialContextTokens.reduce((sum, value) => sum + value, 0)
  return {
    outcomes: { results: results.length, passed, failed: results.length - passed },
    firstPass: { eligibleResults: results.length, passedFirstPass: firstPassPassed, ratePct: percentage(firstPassPassed, results.length) },
    corrections: { total: corrections, resultsWithCorrections, ratePct: percentage(resultsWithCorrections, results.length) },
    context: {
      measuredResults: contextTokens.length,
      totalEstimatedTokens: totalContextTokens,
      averageEstimatedTokens: contextTokens.length ? Math.round(totalContextTokens / contextTokens.length) : 0,
      p95EstimatedTokens: percentile(contextTokens, 0.95),
      maxEstimatedTokens: contextTokens.length ? Math.max(...contextTokens) : 0,
      totalEstimatedInitialTokens: totalInitialContextTokens,
      averageEstimatedInitialTokens: initialContextTokens.length ? Math.round(totalInitialContextTokens / initialContextTokens.length) : 0,
    },
    misuse: { totalViolations, resultsWithViolations, ratePct: percentage(resultsWithViolations, results.length), byCategory: violationsByCategory },
    reviewVerdicts: verdicts,
  }
}

export function sanitizeReportText(value, roots = []) {
  let result = String(value ?? '')
  for (const root of [...roots, os.homedir()].filter(Boolean).sort((left, right) => right.length - left.length)) result = result.split(root).join('<redacted-path>')
  result = result.replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs]|AKIA)[-_A-Za-z0-9]{10,}\b/g, '<redacted-secret>')
  result = result.replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '<redacted-secret>')
  return result.slice(0, ERROR_LIMIT)
}

function sanitizeObject(value, roots) {
  if (typeof value === 'string') return sanitizeReportText(value, roots)
  if (Array.isArray(value)) return value.map((entry) => sanitizeObject(entry, roots))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeObject(entry, roots)]))
  return value
}

function schemaTypeMatches(value, expected) {
  if (expected === 'null') return value === null
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (expected === 'integer') return Number.isInteger(value)
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === expected
}

function resolveSchemaReference(rootSchema, reference) {
  if (!reference.startsWith('#/')) throw new Error(`unsupported release schema reference ${reference}`)
  return reference.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], rootSchema)
}

function validateJsonSchema(value, schema, rootSchema = schema, location = '$') {
  if (schema.$ref) return validateJsonSchema(value, resolveSchemaReference(rootSchema, schema.$ref), rootSchema, location)
  const errors = []
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some((type) => schemaTypeMatches(value, type))) return [`${location} has the wrong type`]
  if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(`${location} differs from its constant`)
  if (schema.enum && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) errors.push(`${location} is outside its enum`)
  if (typeof value === 'string') {
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) errors.push(`${location} exceeds maxLength`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location} does not match its pattern`)
  }
  if (typeof value === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${location} is below minimum`)
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${location} exceeds maximum`)
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${location} exceeds maxItems`)
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) errors.push(`${location} must contain unique items`)
    if (schema.items) value.forEach((entry, index) => errors.push(...validateJsonSchema(entry, schema.items, rootSchema, `${location}[${index}]`)))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) errors.push(`${location}.${required} is required`)
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${location}.${key} is not allowed`)
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...validateJsonSchema(value[key], childSchema, rootSchema, `${location}.${key}`))
    }
  }
  return errors
}

function resultFiles(root) {
  const directory = path.join(root, '.ai', 'harness', 'results')
  if (!fs.existsSync(directory)) return new Set()
  return new Set(fs.readdirSync(directory).filter((file) => file.endsWith('.json')))
}

function readNewResults(root, before) {
  const directory = path.join(root, '.ai', 'harness', 'results')
  if (!fs.existsSync(directory)) return []
  const results = []
  for (const file of fs.readdirSync(directory).filter((entry) => entry.endsWith('.json') && !before.has(entry)).sort()) {
    const absolute = path.join(directory, file)
    const stat = fs.lstatSync(absolute)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > RESULT_LIMIT || file.includes('-release-')) continue
    try { results.push({ path: path.relative(root, absolute).replaceAll(path.sep, '/'), value: readJson(absolute) }) } catch { /* evaluator owns schema validation */ }
  }
  return results
}

function execute(command, args, cwd, timeout) {
  const started = Date.now()
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env: process.env })
  return { ...result, durationMs: Date.now() - started }
}

function stepResult(step, execution, artifacts, roots, expectedArtifacts) {
  const artifactMismatch = Number.isInteger(expectedArtifacts) && artifacts.length !== expectedArtifacts
  const status = execution.status === 0 && !execution.error && !artifactMismatch ? 'pass' : 'fail'
  const diagnostic = artifactMismatch
    ? `expected ${expectedArtifacts} result artifacts, found ${artifacts.length}`
    : execution.error?.message || execution.stderr || (status === 'fail' ? execution.stdout : '')
  return {
    id: step.id,
    kind: step.kind,
    ...(step.caseId ? { caseId: step.caseId } : {}),
    ...(step.runner ? { runner: step.runner } : {}),
    status,
    exitStatus: execution.status,
    durationMs: execution.durationMs,
    resultPaths: artifacts.map((entry) => entry.path),
    ...(diagnostic ? { sanitizedError: sanitizeReportText(diagnostic, roots) } : {}),
  }
}

function skippedStep(step, reason) {
  return {
    id: step.id,
    kind: step.kind,
    ...(step.caseId ? { caseId: step.caseId } : {}),
    ...(step.runner ? { runner: step.runner } : {}),
    status: 'skipped',
    exitStatus: null,
    durationMs: 0,
    resultPaths: [],
    sanitizedError: reason,
  }
}

function executedCoverage(plan, steps, results) {
  const deterministic = steps.find((step) => step.kind === 'deterministic')?.observedCaseIds ?? []
  const routing = plan.coverage.routing.map((entry) => {
    const executedCaseIds = sortedUnique(results.filter((result) => result.runner === entry.runner && result.evaluationKind === 'routing' && !result.sourceResult).map((result) => result.caseId))
    return { runner: entry.runner, expectedCaseIds: entry.expectedCaseIds, executedCaseIds, missingCaseIds: difference(entry.expectedCaseIds, executedCaseIds) }
  })
  const writableExecuted = sortedUnique(results.filter((result) => WRITABLE_KINDS.has(result.evaluationKind) && !result.sourceResult).map((result) => result.caseId))
  const reviewExecuted = sortedUnique(results.filter((result) => result.sourceResult).map((result) => result.caseId))
  const validationExecuted = steps.filter((step) => step.kind === 'validation' && step.status !== 'skipped').map((step) => `yarn ${step.id.slice('validation:'.length)}`)
  return {
    deterministic: { ...plan.coverage.deterministic, executedCaseIds: deterministic, missingCaseIds: difference(plan.coverage.deterministic.expectedCaseIds, deterministic) },
    routing,
    writable: { ...plan.coverage.writable, executedCaseIds: writableExecuted, missingCaseIds: difference(plan.coverage.writable.expectedCaseIds, writableExecuted) },
    review: { ...plan.coverage.review, executedCaseIds: reviewExecuted, missingCaseIds: difference(plan.coverage.review.expectedCaseIds, reviewExecuted) },
    registry: plan.coverage.registry,
    validation: { ...plan.coverage.validation, executedCommands: validationExecuted, missingExecutedCommands: difference(plan.coverage.validation.expectedCommands, validationExecuted) },
  }
}

function writeReport(root, report, roots, schema) {
  const directory = path.join(root, '.ai', 'harness', 'results')
  fs.mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(directory, `${stamp}-release-suite.json`)
  const sanitized = sanitizeObject(report, roots)
  const schemaErrors = validateJsonSchema(sanitized, schema)
  if (schemaErrors.length) throw new Error(`release report schema validation failed: ${schemaErrors.slice(0, 8).join('; ')}`)
  fs.writeFileSync(file, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 })
  return path.relative(root, file).replaceAll(path.sep, '/')
}

function initialReport(plan, startedAt) {
  return {
    schemaVersion: 1,
    status: 'fail',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    catalog: plan.catalog,
    coverage: executedCoverage(plan, [], []),
    steps: [],
    metrics: aggregateQualityMetrics([]),
    violations: plan.violations.map((entry) => entry.slice(0, VIOLATION_LIMIT)),
  }
}

export function main(argv = process.argv.slice(2)) {
  const wallStarted = Date.now()
  const startedAt = new Date().toISOString()
  let options
  try { options = parseArgs(argv) } catch (error) { console.error(error.message); console.error(usage()); return 2 }
  if (options.help) { console.log(usage()); return 0 }
  let root
  try { root = fs.realpathSync(options.root) } catch { console.error('release root is unavailable'); return 2 }
  const harnessDir = path.join(root, '.ai', 'harness')
  if (!fs.existsSync(harnessDir)) { console.error(`harness directory not found under release root`); return 2 }
  let targetsManifest
  try {
    const stat = fs.lstatSync(options.writableTargets)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > RESULT_LIMIT) throw new Error('manifest must be a bounded regular file')
    targetsManifest = readJson(options.writableTargets)
  } catch (error) {
    console.error(`cannot read writable target manifest: ${error.message}`)
    return 2
  }
  let cases
  let registry
  let releaseMatrix
  let fixtures
  let seeds
  let releaseResultSchema
  try {
    cases = readJson(path.join(harnessDir, 'cases.json'))
    registry = readJson(path.join(harnessDir, 'validators.json'))
    releaseMatrix = readJson(path.join(harnessDir, 'release-matrix.json'))
    fixtures = readJson(path.join(harnessDir, 'fixtures', 'index.json'))
    seeds = readJson(path.join(harnessDir, 'fixtures', 'seeds.json'))
    releaseResultSchema = readJson(path.join(harnessDir, 'release-result.schema.json'))
  } catch {
    console.error('release harness inputs are missing or invalid')
    return 2
  }
  const plan = buildReleasePlan({ cases, registry, releaseMatrix, fixtures, seeds, targetsManifest, root })
  const targetRoots = Object.values(plan.targets).filter((entry) => typeof entry === 'string' && path.isAbsolute(entry)).map((entry) => path.resolve(entry))
  const roots = [root, ...targetRoots]
  if (plan.violations.length) {
    const report = initialReport(plan, startedAt)
    report.durationMs = Date.now() - wallStarted
    report.finishedAt = new Date().toISOString()
    const reportPath = writeReport(root, report, roots, releaseResultSchema)
    console.error(`Release preflight failed; report: ${reportPath}`)
    for (const violation of plan.violations) console.error(`- ${violation}`)
    return 1
  }

  const evaluator = path.join(root, 'scripts', 'evaluate-agent-harness.mjs')
  const preparer = path.join(root, 'scripts', 'prepare-agent-harness-fixture.mjs')
  const steps = []
  const resultArtifacts = []
  const deterministicStep = plan.steps.find((step) => step.kind === 'deterministic')
  const deterministicExecution = execute(process.execPath, [evaluator, '--root', root, '--all'], root, options.caseTimeout * Math.max(1, plan.catalog.caseCount) + 60_000)
  const deterministicObserved = sortedUnique((deterministicExecution.stdout ?? '').match(/^PASS (OMH-[0-9]{3})/gm)?.map((entry) => entry.slice('PASS '.length)) ?? [])
  const deterministicResult = stepResult(deterministicStep, deterministicExecution, [], roots)
  deterministicResult.observedCaseIds = deterministicObserved
  if (deterministicObserved.length !== plan.catalog.caseCount) {
    deterministicResult.status = 'fail'
    deterministicResult.sanitizedError = `expected ${plan.catalog.caseCount} deterministic cases, observed ${deterministicObserved.length}`
  }
  steps.push(deterministicResult)

  const validationSteps = plan.steps.filter((step) => step.kind === 'validation')
  if (deterministicResult.status === 'pass') {
    const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
    for (const step of validationSteps) {
      const script = step.command.slice('yarn '.length)
      const execution = execute(yarn, [script], root, options.validationTimeout)
      steps.push(stepResult(step, execution, [], roots))
    }
  } else {
    for (const step of validationSteps) steps.push(skippedStep(step, 'deterministic gate failed'))
  }

  const foundationsPassed = deterministicResult.status === 'pass'
    && steps.filter((step) => step.kind === 'validation').every((step) => step.status === 'pass')
  const modelSteps = plan.steps.filter((step) => ['routing', 'fixture', 'writable', 'review'].includes(step.kind))
  if (!foundationsPassed) {
    for (const step of modelSteps) steps.push(skippedStep(step, 'deterministic or validation foundation failed'))
  } else {
    for (const step of plan.steps.filter((entry) => entry.kind === 'routing')) {
      const before = resultFiles(root)
      const execution = execute(process.execPath, [
        evaluator, '--root', root, '--runner', step.runner, '--all', '--model', releaseMatrix.routing[step.runner].modelSelector,
        '--timeout', String(options.caseTimeout),
      ], root, options.caseTimeout * Math.max(1, step.expectedCaseIds.length) + 60_000)
      const artifacts = readNewResults(root, before)
      resultArtifacts.push(...artifacts)
      steps.push(stepResult(step, execution, artifacts, roots, step.expectedCaseIds.length))
    }

    for (const caseId of plan.coverage.writable.expectedCaseIds) {
      const fixtureStep = plan.steps.find((step) => step.id === `fixture:${caseId}`)
      const writableStep = plan.steps.find((step) => step.id === `writable:${caseId}`)
      const reviewStep = plan.steps.find((step) => step.id === `review:${caseId}`)
      const target = plan.targets[caseId]
      const fixtureExecution = execute(process.execPath, [preparer, '--case', caseId, '--target', target, '--acknowledge-writes'], root, 120_000)
      const fixtureResult = stepResult(fixtureStep, fixtureExecution, [], roots)
      steps.push(fixtureResult)
      if (fixtureResult.status !== 'pass') {
        steps.push(skippedStep(writableStep, 'fixture preparation failed'))
        if (reviewStep) steps.push(skippedStep(reviewStep, 'writable gate did not pass'))
        continue
      }
      const beforeWritable = resultFiles(root)
      const writableExecution = execute(process.execPath, [
        evaluator, '--root', root, '--runner', writableStep.runner, '--case', caseId,
        '--model', writableStep.modelSelector, '--timeout', String(options.caseTimeout),
        '--writable-root', target, '--acknowledge-writes',
      ], root, options.caseTimeout + 120_000)
      const writableArtifacts = readNewResults(root, beforeWritable)
      resultArtifacts.push(...writableArtifacts)
      const writableResult = stepResult(writableStep, writableExecution, writableArtifacts, roots, 1)
      steps.push(writableResult)
      const sourceArtifact = writableArtifacts.find((entry) => entry.value.caseId === caseId && WRITABLE_KINDS.has(entry.value.evaluationKind))
      if (!reviewStep) continue
      if (writableResult.status !== 'pass' || !sourceArtifact || sourceArtifact.value.status !== 'pass') {
        steps.push(skippedStep(reviewStep, 'writable gate did not pass'))
        continue
      }
      const beforeReview = resultFiles(root)
      const reviewExecution = execute(process.execPath, [
        evaluator, '--root', root, '--runner', reviewStep.runner,
        '--model', reviewStep.modelSelector, '--timeout', String(options.caseTimeout),
        '--review-writable-result', path.join(root, sourceArtifact.path), '--writable-root', target,
      ], root, options.caseTimeout + 60_000)
      const reviewArtifacts = readNewResults(root, beforeReview)
      resultArtifacts.push(...reviewArtifacts)
      steps.push(stepResult(reviewStep, reviewExecution, reviewArtifacts, roots, 1))
    }
  }

  const values = resultArtifacts.map((entry) => entry.value)
  const coverage = executedCoverage(plan, steps, values)
  const executionViolations = steps.filter((step) => step.status !== 'pass').map((step) => `${step.id} ${step.status}`).slice(0, 256)
  const coverageIncomplete = coverage.deterministic.missingCaseIds.length
    || coverage.routing.some((entry) => entry.missingCaseIds.length)
    || coverage.writable.missingCaseIds.length
    || coverage.review.missingCaseIds.length
    || coverage.validation.missingExecutedCommands.length
  const status = executionViolations.length === 0 && !coverageIncomplete ? 'pass' : 'fail'
  const report = {
    schemaVersion: 1,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - wallStarted,
    catalog: plan.catalog,
    coverage,
    steps,
    metrics: aggregateQualityMetrics(values),
    violations: executionViolations.map((entry) => entry.slice(0, VIOLATION_LIMIT)),
  }
  const reportPath = writeReport(root, report, roots, releaseResultSchema)
  console.log(`${status === 'pass' ? 'PASS' : 'FAIL'} release suite — ${reportPath}`)
  return status === 'pass' ? 0 : 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = main()
