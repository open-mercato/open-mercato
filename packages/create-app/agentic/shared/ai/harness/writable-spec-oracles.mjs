#!/usr/bin/env node

// Fixed, controller-owned grader for the two SPEC-P2 writable planning proofs. The other two
// writable runners grade TypeScript: `writable-ast-oracles.mjs` reads a target's own compiler
// facts, `writable-behavior-oracles.mjs` executes a compiled seam. A planning proof produces
// no TypeScript at all — its only permitted artifact is Markdown under `.ai/specs/` — so it
// gets its own fixed runner rather than a Markdown branch bolted onto the AST oracle. The
// case table below is hard-coded exactly like the other two runners: a case cannot bring its
// own grading rules, and the evaluator resolves this file only for the two validator IDs it
// owns.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const EXIT_PASS = 0
const EXIT_FAILURE = 1
const EXIT_INVALID = 2

const SPEC_ROOT = '.ai/specs'
const RESERVED_SPEC_FILES = Object.freeze(['README.md', 'SPEC-000-template.md'])
const SPEC_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const MAX_SPEC_BYTES = 256 * 1024
const MODULE_ROOT = 'src/modules'
const MODULE_REGISTRY = 'src/modules.ts'
const PLACEHOLDER_TOKEN_PATTERN = /(?:^|[^A-Za-z])(?:TBD|TODO|FIXME|XXX|lorem ipsum)(?:[^A-Za-z]|$)/i
// Matches an unfilled `{…}` skeleton slot such as `{module}`, `{YYYY-MM-DD}`, or
// `{why it fits the platform}`, while leaving inline object prose like `{ items, totalCount }`
// alone: a real slot carries no comma and no padding space.
const CURLY_PLACEHOLDER_PATTERN = /\{(?!\s)[^{}\n,]{1,80}(?<!\s)\}/
const PHASE_HEADING_PATTERN = /^#{3,4}\s+Phase\s+(\d+)\b/i
const TEST_IDENTIFIER_PATTERN = /\bTEST-\d{3}\b|[\w./-]+\.(?:test|spec)\.tsx?\b|__integration__/
// Reserved scaffolding must still look like scaffolding afterwards. Byte equality against the
// controller is not usable: `.ai/specs/README.md` carries the generated project name, which
// legitimately differs between the controller app and the disposable target.
const RESERVED_SPEC_MARKERS = Object.freeze({
  'README.md': /^#\s+Feature Specs/m,
  'SPEC-000-template.md': /\{Title\}/,
})

// Each requirement resolves to one distinct level-2 section, preferring the exact heading the
// scaffold's own skeleton ships (`.ai/specs/SPEC-000-template.md`) before looser synonyms, so a
// plan written from the routed template satisfies it without renaming anything.
const REQUIRED_SECTIONS = Object.freeze([
  {
    id: 'problem',
    requirement: 'a problem statement',
    patterns: [/^problem statement$/i, /problem/i, /background/i],
    minWords: 80,
  },
  {
    id: 'contracts',
    requirement: 'a contract section',
    patterns: [/api[,\s].*contract/i, /^data models?$/i, /contract/i, /\bapi\b/i],
    minWords: 80,
  },
  {
    id: 'tests',
    requirement: 'a test coverage section',
    patterns: [/integration coverage/i, /^tests?\b/i, /test/i, /verification/i],
    minWords: 40,
  },
  {
    id: 'phases',
    requirement: 'a phased implementation section',
    patterns: [/implementation phases?/i, /implementation plan/i, /phase/i, /implementation/i],
    minWords: 80,
  },
])

const SPEC_CASES = Object.freeze({
  'OMH-223': {
    kind: 'new-feature',
    // The ordering proof is that planning delivered one covering spec and no implementation.
    // These are the module-directory names a warehouse-transfer implementation would occupy.
    implementationKeywords: ['transfer', 'warehouse'],
  },
  'OMH-224': {
    kind: 'existing-spec',
    coveringSpec: `${SPEC_ROOT}/2026-08-04-service-appointment-reminders.md`,
    // Fixed expectations for the contract change the prompt introduces. Hard-coded here, never
    // derived from the seeded file or from the answer under grading.
    amendments: [
      {
        id: 'rescheduled-and-cancelled',
        requirement: 'the amended contract must cover rescheduled and cancelled appointments',
        all: [/reschedul/i, /cancel/i],
      },
      {
        id: 'per-channel-outcome',
        requirement: 'the amended contract must record a per-channel delivery outcome including SMS',
        all: [/\bsms\b/i, /per[-\s]channel|delivery (?:outcome|status|result)/i],
      },
    ],
    // The amendment must not silently drop the behavior the covering spec already committed to.
    preserved: [
      {
        id: 'confirmed-reminder',
        requirement: 'the original confirmed-appointment reminder contract must survive the amendment',
        pattern: /confirmed appointment/i,
      },
    ],
    minChangelogEntries: 2,
    implementationKeywords: ['reminder', 'appointment'],
  },
})

function check(id, passed, requirement) {
  return { id, passed, requirement }
}

function isSafeRelative(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\0')) return false
  return !relative.replaceAll('\\', '/').split('/').includes('..')
}

function readContainedFile(root, relative) {
  if (!isSafeRelative(relative)) return null
  const lexical = path.resolve(root, relative)
  if (path.relative(root, lexical).startsWith('..')) return null
  let stat
  try { stat = fs.lstatSync(lexical) } catch { return null }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SPEC_BYTES) return null
  try { return fs.readFileSync(lexical, 'utf8') } catch { return null }
}

function listSpecFiles(root) {
  const directory = path.join(root, ...SPEC_ROOT.split('/'))
  let entries
  try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
}

function authoredSpecFiles(root) {
  return listSpecFiles(root).filter((name) => !RESERVED_SPEC_FILES.includes(name))
}

// Splits a Markdown document into its level-2 sections, ignoring headings inside fenced code
// blocks so an ASCII wireframe cannot fabricate a section.
function level2Sections(markdown) {
  const sections = []
  let fenced = false
  let current = null
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced
    if (!fenced) {
      const heading = /^##\s+(.+?)\s*$/.exec(line)
      if (heading) {
        current = { heading: heading[1], lines: [] }
        sections.push(current)
        continue
      }
    }
    if (current) current.lines.push(line)
  }
  return sections.map((section) => ({ heading: section.heading, body: section.lines.join('\n') }))
}

function strippedOfCodeBlocks(body) {
  const kept = []
  let fenced = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue }
    if (!fenced) kept.push(line)
  }
  return kept.join('\n')
}

function wordCount(body) {
  return strippedOfCodeBlocks(body).split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length
}

function placeholderReason(body) {
  const prose = strippedOfCodeBlocks(body)
  if (PLACEHOLDER_TOKEN_PATTERN.test(prose)) return 'an unresolved TODO/TBD marker'
  if (CURLY_PLACEHOLDER_PATTERN.test(prose)) return 'an unfilled {…} skeleton slot'
  return null
}

function orderedPhaseNumbers(body) {
  const numbers = []
  let fenced = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    const match = PHASE_HEADING_PATTERN.exec(line)
    if (match) numbers.push(Number(match[1]))
  }
  return numbers
}

function changelogEntryCount(markdown) {
  const section = level2Sections(markdown).find((entry) => /changelog/i.test(entry.heading))
  if (!section) return 0
  const lines = strippedOfCodeBlocks(section.body).split(/\r?\n/)
  const rows = lines.filter((line) => /^\s*\|/.test(line)
    && !/^\s*\|[\s:|-]*\|\s*$/.test(line)
    && !/^\s*\|\s*date\s*\|/i.test(line))
  const bullets = lines.filter((line) => /^\s*[-*]\s+\S/.test(line))
  return rows.length + bullets.length
}

function resolveRequiredSections(markdown) {
  const sections = level2Sections(markdown)
  const claimed = new Set()
  const resolved = new Map()
  for (const requirement of REQUIRED_SECTIONS) {
    let match
    for (const pattern of requirement.patterns) {
      match = sections.find((section) => !claimed.has(section) && pattern.test(section.heading))
      if (match) break
    }
    if (match) claimed.add(match)
    resolved.set(requirement.id, match ?? null)
  }
  return resolved
}

function specStructureChecks(markdown) {
  const checks = []
  const resolved = resolveRequiredSections(markdown)
  for (const requirement of REQUIRED_SECTIONS) {
    const match = resolved.get(requirement.id)
    if (!match) {
      checks.push(check(`spec.section.${requirement.id}`, false, `the specification needs ${requirement.requirement}`))
      continue
    }
    const words = wordCount(match.body)
    checks.push(check(
      `spec.section.${requirement.id}`,
      words >= requirement.minWords,
      `${requirement.requirement} needs at least ${requirement.minWords} words of substance (found ${words} under "${match.heading}")`,
    ))
    const placeholder = placeholderReason(match.body)
    checks.push(check(
      `spec.substantive.${requirement.id}`,
      placeholder === null,
      `${requirement.requirement} must be written, not templated${placeholder ? ` (found ${placeholder})` : ''}`,
    ))
    if (requirement.id === 'phases') {
      const phases = orderedPhaseNumbers(match.body)
      checks.push(check(
        'spec.phases.ordered',
        phases.length >= 2 && phases.every((value, index) => value === index + 1),
        `the implementation section needs at least two dependency-ordered phases numbered from 1 (found ${phases.join(', ') || 'none'})`,
      ))
    }
    if (requirement.id === 'tests') {
      checks.push(check(
        'spec.tests.identified',
        TEST_IDENTIFIER_PATTERN.test(strippedOfCodeBlocks(match.body)),
        'the test section must name concrete test IDs or test file paths',
      ))
    }
  }
  return checks
}

function reservedSpecChecks(root) {
  return RESERVED_SPEC_FILES.map((name) => {
    const contents = readContainedFile(root, `${SPEC_ROOT}/${name}`)
    return check(
      `reserved.${name}`,
      contents !== null && RESERVED_SPEC_MARKERS[name].test(contents),
      `${SPEC_ROOT}/${name} must remain the emitted scaffolding, not the delivered specification`,
    )
  })
}

function implementationChecks(root, definition) {
  const keywords = definition.implementationKeywords
  const moduleDirectory = path.join(root, ...MODULE_ROOT.split('/'))
  let moduleNames = []
  try {
    moduleNames = fs.readdirSync(moduleDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.toLowerCase())
  } catch { moduleNames = [] }
  const registry = (readContainedFile(root, MODULE_REGISTRY) ?? '').toLowerCase()
  const implicated = keywords.filter((keyword) => moduleNames.some((name) => name.includes(keyword)) || registry.includes(keyword))
  return [check(
    'planning.implementation-absent',
    implicated.length === 0,
    `planning must not start implementation: no module directory or registry entry may name ${keywords.join(' or ')}${implicated.length ? ` (found ${implicated.join(', ')})` : ''}`,
  )]
}

function newFeatureChecks(root) {
  const authored = authoredSpecFiles(root)
  const checks = [check(
    'spec.single',
    authored.length === 1,
    `exactly one new specification must exist under ${SPEC_ROOT} (found ${authored.length ? authored.join(', ') : 'none'})`,
  )]
  if (authored.length !== 1) return checks
  const [name] = authored
  checks.push(check('spec.named', SPEC_FILE_PATTERN.test(name), `the specification must be named {YYYY-MM-DD}-{slug}.md (found ${name})`))
  const markdown = readContainedFile(root, `${SPEC_ROOT}/${name}`)
  if (markdown === null) {
    checks.push(check('spec.readable', false, `${SPEC_ROOT}/${name} must be a readable bounded regular file`))
    return checks
  }
  checks.push(...specStructureChecks(markdown))
  return checks
}

function existingSpecChecks(root, definition) {
  const authored = authoredSpecFiles(root)
  const expected = definition.coveringSpec.slice(`${SPEC_ROOT}/`.length)
  const checks = [check(
    'spec.single',
    authored.length === 1 && authored[0] === expected,
    `${definition.coveringSpec} must be the only specification (found ${authored.length ? authored.join(', ') : 'none'})`,
  )]
  const markdown = readContainedFile(root, definition.coveringSpec)
  if (markdown === null) {
    checks.push(check('spec.readable', false, `${definition.coveringSpec} must be a readable bounded regular file`))
    return checks
  }
  checks.push(...specStructureChecks(markdown))
  const prose = strippedOfCodeBlocks(markdown)
  for (const amendment of definition.amendments) {
    checks.push(check(
      `spec.amendment.${amendment.id}`,
      amendment.all.every((pattern) => pattern.test(prose)),
      amendment.requirement,
    ))
  }
  for (const preserved of definition.preserved) {
    checks.push(check(`spec.preserved.${preserved.id}`, preserved.pattern.test(prose), preserved.requirement))
  }
  const entries = changelogEntryCount(markdown)
  checks.push(check(
    'spec.changelog.amended',
    entries >= definition.minChangelogEntries,
    `the covering spec changelog must record the amendment (needs at least ${definition.minChangelogEntries} entries, found ${entries})`,
  ))
  return checks
}

export function evaluateWritableSpecOracle({ root: requestedRoot, caseId, phase }) {
  if (typeof requestedRoot !== 'string' || !path.isAbsolute(requestedRoot)) throw new Error('root must be absolute')
  const definition = SPEC_CASES[caseId]
  if (!definition) throw new Error(`unsupported writable spec case: ${caseId}`)
  if (!['before', 'after'].includes(phase)) throw new Error('phase must be before or after')
  const root = fs.realpathSync(requestedRoot)
  const checks = [
    ...(definition.kind === 'new-feature' ? newFeatureChecks(root) : existingSpecChecks(root, definition)),
    ...reservedSpecChecks(root),
    ...implementationChecks(root, definition),
  ]
  const failures = checks.filter((entry) => !entry.passed).map((entry) => `${entry.id}: ${entry.requirement}`)
  return { passed: failures.length === 0, failures, checks }
}

function usage() {
  return `Grade one writable planning proof against its fixed specification contract.

Usage:
  node .ai/harness/writable-spec-oracles.mjs --root /absolute/app --case ${Object.keys(SPEC_CASES).join('|')} --phase before|after [--json]`
}

function parseArgs(argv) {
  const options = { root: undefined, caseId: undefined, phase: undefined, json: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`)
      index += 1
      return next
    }
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--root') options.root = value()
    else if (arg === '--case') options.caseId = value()
    else if (arg === '--phase') options.phase = value()
    else if (arg === '--json') options.json = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function emit(result, json) {
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`)
  else process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'}: ${result.failures.join('; ') || 'all specification checks passed'}\n`)
}

function main() {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) {
    process.stdout.write(`${JSON.stringify({ passed: false, failures: [error.message], checks: [] })}\n`)
    return EXIT_INVALID
  }
  if (options.help) { process.stdout.write(`${usage()}\n`); return EXIT_PASS }
  try {
    const result = evaluateWritableSpecOracle(options)
    emit(result, options.json)
    return result.passed ? EXIT_PASS : EXIT_FAILURE
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ passed: false, failures: [message], checks: [] }, options.json)
    return EXIT_INVALID
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
