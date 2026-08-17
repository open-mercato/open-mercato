#!/usr/bin/env node

// Fixed, controller-owned grader for the SPEC-P2 writable planning and resume proofs. The other two
// writable runners grade TypeScript: `writable-ast-oracles.mjs` reads a target's own compiler
// facts, `writable-behavior-oracles.mjs` executes a compiled seam. A planning proof produces
// no TypeScript at all — its only permitted artifact is Markdown under `.ai/specs/` — so it
// gets its own fixed runner rather than a Markdown branch bolted onto the AST oracle. The
// case table below is hard-coded exactly like the other two runners: a case cannot bring its
// own grading rules, and the evaluator resolves this file only for the validator IDs it
// owns.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const EXIT_PASS = 0
const EXIT_FAILURE = 1
const EXIT_INVALID = 2

const SPEC_ROOT = '.ai/specs'
// Everything the scaffold itself emits under `.ai/specs`. None of these is an authored
// deliverable, so a planning proof neither counts them nor may repurpose them: the folder
// README, the blank skeleton, and the shipped covering specification for reference-module
// activation that gives the `reuse-spec` routing row an honest target.
const RESERVED_SPEC_FILES = Object.freeze([
  'README.md',
  'SPEC-000-template.md',
  '2026-08-06-reference-module-activation.md',
])
const SPEC_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const MAX_SPEC_BYTES = 256 * 1024
const MAX_FACT_BYTES = 1024 * 1024
const MODULE_ROOT = 'src/modules'
const MODULE_REGISTRY = 'src/modules.ts'
const PLACEHOLDER_TOKEN_PATTERN = /(?:^|[^A-Za-z])(?:TBD|TODO|FIXME|XXX|lorem ipsum)(?:[^A-Za-z]|$)/
// Matches an unfilled `{…}` skeleton slot such as `{module}`, `{YYYY-MM-DD}`, or
// `{why it fits the platform}`, while leaving inline object prose like `{ items, totalCount }`
// alone: a real slot carries no comma and no padding space.
const CURLY_PLACEHOLDER_PATTERN = /\{(?!\s)[^{}\n,]{1,80}(?<!\s)\}/
const PHASE_HEADING_PATTERN = /^#{3,4}\s+Phase\s+(\d+)\b/i
const TEST_IDENTIFIER_PATTERN = /\bTEST-\d{3}\b|[\w./-]+\.(?:test|spec)\.tsx?\b|__integration__/

// --- module-shaped planning contract ------------------------------------------------------
// A module-shaped proof must ground its implementation in the reference module the app already
// ships rather than describing a second teaching module. These are the target-side facts the
// oracle reads to check that grounding; the plan under grading never supplies them.
const EXAMPLE_ROOT = 'src/modules/example'
const EXAMPLE_INVENTORY = `${EXAMPLE_ROOT}/references/surface-inventory.json`
const REFERENCE_FACTS = '.ai/guides/reference-module-facts.json'
const SOURCE_LINK_INVENTORY = '.ai/harness/source-link-inventory.json'
const REFERENCE_SHEET = '.ai/guides/reference-modules/example/index.md'
const EXAMPLE_FILE_PATTERN = /\bsrc\/modules\/example\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+\b/g
// A directory-only or globbed hint is not a source link. `src/modules/example/api/**`,
// `src/modules/example/widgets/*.ts` and a bare `src/modules/example/commands/` all name a
// place to look rather than a file to read, which is exactly what the read policy forbids.
const EXAMPLE_GLOB_PATTERN = /\bsrc\/modules\/example\/[A-Za-z0-9._/-]*(?:\*|\/(?=[\s`)|,.]|$))/
const AFTER_OPT_IN_PATTERN = /(?:source[-\s]present|not registered|unregistered|disabled|inert)[\s\S]{0,120}?(?:opt[-\s]?in|until it is registered|registration)|(?:opt[-\s]?in|register(?:ed|ing)?)[\s\S]{0,120}?(?:source[-\s]present|not registered|unregistered|disabled|inert)/i
const BULK_ACTION_CAPABILITY = 'umes.injection.datatable-bulk-action'
const BULK_PROGRESS_CAPABILITY = 'runtime.bulk-operation-progress'
const WORKFLOW_CAPABILITY = 'workflows.code-definition'
const BULK_CONTRIBUTION = 'example.injection.todo-bulk-complete@data-table:example.todos.list:bulk-actions'
const WORKFLOW_CONTRIBUTION = 'workflow:example.todo-created-reference'
const BULK_WORKERS = Object.freeze(['example:todos-bulk-dispatch', 'example:todos-bulk-complete'])
const REQUIRED_SOURCE_REFERENCES = Object.freeze([
  'om-module-scaffold/data-and-migrations:data/entities.ts',
  'om-module-scaffold/api-and-domain:commands/todos.ts',
  'om-backend-ui-design/crud-surfaces:widgets/injection/customer-priority-bulk-actions/widget.ts',
])
const REQUIRED_DESIGN_REFERENCES = Object.freeze([
  'om-backend-ui-design/frontend-and-design-system:node_modules/@open-mercato/core/src/modules/design_system/gallery/entries/buttons.tsx',
  'om-backend-ui-design/frontend-and-design-system:node_modules/@open-mercato/ui/src/primitives/button.tsx',
  'om-backend-ui-design/frontend-and-design-system:node_modules/@open-mercato/ui/figma/button.figma.tsx',
  'om-backend-ui-design/frontend-and-design-system:src/app/globals.css',
])
const REQUIRED_DESIGN_REFERENCE_ROLES = Object.freeze([
  'design-system-gallery',
  'design-system-implementation',
  'figma-code-connect',
  'design-foundation-token',
])
const GALLERY_ITEM_ID = 'buttons/button'
const GALLERY_FAMILY_ID = 'buttons'
const GALLERY_ENTRY_ID = 'button'
const GALLERY_PACKAGE_SHA = 'bf25803d7a8c85c8552db9e76c7cc4398d1768be'
const FOUNDATION_AUDITED_SHA = 'fb9b8ddfe4470ef11d312caa4628c46af7d48adf'
const FOUNDATION_PACKAGE_SHA = 'b2d26489c683edc44265212ac8a79be1b981774f'
const UNSAFE_DESIGN_AUTHORITY_PATTERNS = Object.freeze([
  { id: 'example-design-system-runtime-dependency', pattern: /(?:example[\s\S]{0,80}design_system|design_system[\s\S]{0,80}example)[\s\S]{0,80}(?:runtime dependency|depends on|import)/i },
  { id: 'gallery-rule-owner', pattern: /gallery[\s\S]{0,80}(?:normative|rule owner|implementation contract)/i },
  { id: 'figma-external-authority', pattern: /(?:fetch|request|use|obtain)[\s\S]{0,80}(?:figma credential|figma token)|(?:publish|push)[\s\S]{0,80}(?:code connect|figma)/i },
  { id: 'workspace-token-source', pattern: /apps\/mercato\/src\/app\/globals\.css/i },
])
const SHADOW_MODULE_PATTERNS = Object.freeze([
  { id: 'shadow-teaching-module', pattern: /\b(?:new|second|another|own)\s+(?:teaching|example|demo|reference|sample)\s+module\b/i },
  { id: 'whole-example-copy', pattern: /\bcopy(?:ing)?\s+(?:the\s+)?(?:whole|entire|complete|full)\s+(?:example|reference)\s+(?:module|tree|directory)\b|\bcp\s+-r\s+src\/modules\/example\b/i },
  { id: 'ratelimit-probe-blueprint', pattern: /\bratelimit_probe\b/i },
])
// Fixed by the spec-first routing contract, which owns this vocabulary. `pending-emission` is
// deliberately absent: it is a lifecycle marker on the canonical ledger, not a statement about
// which mechanism a proposed surface uses.
const MECHANISM_CLASSIFICATIONS = Object.freeze([
  'emitted-example',
  'framework-only',
  'catalog-only',
  'currently-unbound',
  'negative-fixture',
])
// Activated canonical output may never claim this one: only a deliberately broken fixture
// produces it, so a plan that proposes it is proposing a defect.
const FORBIDDEN_CLASSIFICATION = 'negative-fixture'
const TRACEABILITY_HEADING_PATTERN = /traceab/i
const REQUIREMENT_ID_PATTERN = /\bREQ-\d{3}\b/
const PHASE_REFERENCE_PATTERN = /\bPhase\s+\d+\b/i
// Reserved scaffolding must still look like scaffolding afterwards. Byte equality against the
// controller is not usable: `.ai/specs/README.md` carries the generated project name, which
// legitimately differs between the controller app and the disposable target.
const RESERVED_SPEC_MARKERS = Object.freeze({
  'README.md': /^#\s+Feature Specs/m,
  'SPEC-000-template.md': /\{Title\}/,
  '2026-08-06-reference-module-activation.md': /^#\s+Reference Module Activation/m,
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
    // Stock transfers are a module, so this proof is also the module-shaped one: its plan has
    // to route implementation to the scaffold skill and name the exact reference sources it
    // will adapt, rather than describing a second teaching module in prose.
    moduleShaped: {
      scaffoldSkill: 'om-module-scaffold',
      minCapabilityIds: 2,
      minExactSourcePaths: 2,
      minTraceabilityRows: 5,
    },
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
  'OMH-230': {
    kind: 'resume',
    coveringSpec: `${SPEC_ROOT}/2026-08-10-interrupted-export-format.md`,
    preservedArtifact: 'src/modules/resume_demo/lib/preserved.ts',
    preservedSource: "export const immutableResumeBaseline = 'verified-v1'\n",
    contractArtifact: 'src/modules/resume_demo/lib/export-contract.ts',
    formatterArtifact: 'src/modules/resume_demo/lib/format-export.ts',
  },
})

function check(id, passed, requirement) {
  return { id, passed, requirement }
}

function isSafeRelative(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\0')) return false
  return !relative.replaceAll('\\', '/').split('/').includes('..')
}

function readContainedFile(root, relative, maxBytes = MAX_SPEC_BYTES) {
  if (!isSafeRelative(relative)) return null
  const lexical = path.resolve(root, relative)
  if (path.relative(root, lexical).startsWith('..')) return null
  let stat
  try { stat = fs.lstatSync(lexical) } catch { return null }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return null
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

// The capability IDs and exact source paths the target's own reference module publishes. Read
// from the target, never from the plan: a plan cannot widen its own grounding by asserting a
// capability the shipped inventory does not carry.
function exampleGrounding(root) {
  const raw = readContainedFile(root, EXAMPLE_INVENTORY)
  if (raw === null) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch { return null }
  const capabilities = Array.isArray(parsed?.capabilities) ? parsed.capabilities : []
  if (!capabilities.length) return null
  const capabilityIds = new Set()
  const sourcePaths = new Set()
  for (const capability of capabilities) {
    if (typeof capability?.capabilityId === 'string') capabilityIds.add(capability.capabilityId)
    for (const relative of capability?.sourcePaths ?? []) if (typeof relative === 'string') sourcePaths.add(relative)
  }
  return { capabilityIds, sourcePaths, inventory: parsed }
}

function readJsonObject(root, relative) {
  const raw = readContainedFile(root, relative, MAX_FACT_BYTES)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function generatedReferenceGrounding(root) {
  const bundle = readJsonObject(root, REFERENCE_FACTS)
  const reference = bundle?.example
  const facts = reference?.facts
  if (
    reference?.projectionKind !== 'activated-reference'
    || reference?.sourceKind !== 'local-reference'
    || reference?.runtimeSelected !== false
    || facts === null
    || typeof facts !== 'object'
  ) return null

  const contributions = Array.isArray(facts.extensionSurfaces?.contributions)
    ? facts.extensionSurfaces.contributions
    : []
  const resolutions = Array.isArray(facts.extensionSurfaces?.contributionResolutions)
    ? facts.extensionSurfaces.contributionResolutions
    : []
  const activations = Array.isArray(facts.extensionSurfaces?.activations)
    ? facts.extensionSurfaces.activations
    : []
  const overrideTargets = Array.isArray(facts.overrideTargets) ? facts.overrideTargets : []
  const workers = Array.isArray(facts.ownedContracts?.worker) ? facts.ownedContracts.worker : []

  const bulkContribution = contributions.find((entry) => entry?.id === BULK_CONTRIBUTION)
  const workflowContribution = contributions.find((entry) => entry?.id === WORKFLOW_CONTRIBUTION)
  const bulkResolution = resolutions.find((entry) => entry?.contributionId === BULK_CONTRIBUTION)
  const activationIds = Array.isArray(bulkResolution?.activationIds) ? bulkResolution.activationIds : []
  const activationSet = new Set(activations.map((entry) => entry?.id).filter((id) => typeof id === 'string'))
  const workerIds = BULK_WORKERS.filter((id) => workers.some((entry) => entry?.id === id))
  const relevantFactKeys = new Set([BULK_CONTRIBUTION, ...workerIds])
  const overrideIds = overrideTargets
    .filter((entry) => relevantFactKeys.has(entry?.factRef?.factKey))
    .map((entry) => entry?.id)
    .filter((id) => typeof id === 'string')

  if (
    !bulkContribution
    || !workflowContribution
    || workflowContribution?.details?.specialistRoute !== 'workflows'
    || activationIds.length === 0
    || !activationIds.every((id) => activationSet.has(id))
    || workerIds.length !== BULK_WORKERS.length
    || overrideIds.length < 3
  ) return null

  return {
    activationIds,
    overrideIds,
    workerIds,
    specialistRoute: workflowContribution.details.specialistRoute,
    workflowSource: workflowContribution?.source?.path,
  }
}

function sourceReferenceGrounding(root) {
  const inventory = readJsonObject(root, SOURCE_LINK_INVENTORY)
  const records = Array.isArray(inventory?.records) ? inventory.records : []
  const byId = new Map(records
    .filter((entry) => typeof entry?.referenceId === 'string')
    .map((entry) => [entry.referenceId, entry]))
  const requiredIds = [...REQUIRED_SOURCE_REFERENCES, ...REQUIRED_DESIGN_REFERENCES]
  if (!requiredIds.every((id) => byId.get(id)?.readStatus === 'readable')) return null
  if (!REQUIRED_DESIGN_REFERENCES.every((id, index) => byId.get(id)?.referenceRole === REQUIRED_DESIGN_REFERENCE_ROLES[index])) {
    return null
  }
  const visual = REQUIRED_DESIGN_REFERENCES
    .flatMap((id) => Array.isArray(byId.get(id)?.visualReferences) ? byId.get(id).visualReferences : [])
    .find((entry) => entry?.galleryItemId === GALLERY_ITEM_ID)
  if (visual?.familyId !== GALLERY_FAMILY_ID || visual?.entryId !== GALLERY_ENTRY_ID) return null
  return { byId, visual }
}

function exactIdentityChecks(prose, values, prefix, requirement) {
  const missing = values.filter((value) => typeof value !== 'string' || !prose.includes(value))
  return check(
    prefix,
    missing.length === 0,
    `${requirement}${missing.length ? ` (missing ${missing.join(', ')})` : ''}`,
  )
}

// Splits every Markdown table in a section into its data rows. Header detection follows the
// grammar rather than the wording: a header is the line immediately above a delimiter row, so a
// data row whose first cell reads `REQ-001` is never mistaken for one.
function tableRows(body) {
  const lines = body.split(/\r?\n/).map((line) => line.trim())
  const isRow = (line) => line.startsWith('|') && line.endsWith('|') && line.length > 2
  const cellsOf = (line) => line.slice(1, -1).split('|').map((cell) => cell.trim())
  const isDelimiter = (line) => isRow(line) && cellsOf(line).every((cell) => /^:?-{2,}:?$/.test(cell))
  const rows = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!isRow(lines[index]) || isDelimiter(lines[index])) continue
    // The header sits directly above the delimiter; skip both and read the body that follows.
    if (index + 1 < lines.length && isDelimiter(lines[index + 1])) { index += 1; continue }
    const cells = cellsOf(lines[index])
    if (cells.length < 3) continue
    rows.push({ cells, text: lines[index] })
  }
  return rows
}

function moduleShapedChecks(root, markdown, contract) {
  const checks = []
  const resolved = resolveRequiredSections(markdown)
  const implementation = resolved.get('phases')
  const prose = strippedOfCodeBlocks(markdown)

  checks.push(check(
    'plan.module-scaffold-route',
    implementation !== null && implementation !== undefined && implementation.body.includes(contract.scaffoldSkill),
    `the implementation section must route module work to \`${contract.scaffoldSkill}\``,
  ))

  const grounding = exampleGrounding(root)
  if (grounding === null) {
    checks.push(check(
      'plan.example-inventory-readable',
      false,
      `the target must ship ${EXAMPLE_INVENTORY}; without it no plan can be checked against the reference module`,
    ))
    return checks
  }

  const citedCapabilities = [...grounding.capabilityIds].filter((id) => prose.includes(id))
  checks.push(check(
    'plan.example-capability-ids',
    citedCapabilities.length >= contract.minCapabilityIds,
    `the plan must name at least ${contract.minCapabilityIds} capability IDs published by ${EXAMPLE_INVENTORY} (found ${citedCapabilities.length ? citedCapabilities.join(', ') : 'none'})`,
  ))

  const cited = [...new Set(prose.match(EXAMPLE_FILE_PATTERN) ?? [])]
  const grounded = cited.filter((relative) => grounding.sourcePaths.has(relative) && readContainedFile(root, relative) !== null)
  checks.push(check(
    'plan.example-exact-source-paths',
    grounded.length >= contract.minExactSourcePaths,
    `the plan must name at least ${contract.minExactSourcePaths} exact reference source files that exist and are mapped by the inventory (found ${grounded.length ? grounded.join(', ') : 'none'})`,
  ))
  const ungrounded = cited.filter((relative) => !grounding.sourcePaths.has(relative))
  checks.push(check(
    'plan.example-paths-resolve',
    ungrounded.length === 0,
    `every named reference source must exist and be mapped by the inventory (unmapped: ${ungrounded.join(', ')})`,
  ))
  const glob = EXAMPLE_GLOB_PATTERN.exec(prose)
  checks.push(check(
    'plan.example-no-directory-hint',
    glob === null,
    `reference sources must be exact files, not a directory or wildcard${glob ? ` (found ${glob[0]})` : ''}`,
  ))

  checks.push(check(
    'plan.example-after-opt-in',
    AFTER_OPT_IN_PATTERN.test(prose),
    'the plan must state that the reference module is source-present and applies only after opt-in, not that it is already live',
  ))

  for (const { id, pattern } of SHADOW_MODULE_PATTERNS) {
    checks.push(check(`plan.rejects.${id}`, !pattern.test(prose), `the plan must not propose ${id.replaceAll('-', ' ')}`))
  }

  const generated = generatedReferenceGrounding(root)
  checks.push(check(
    'plan.reference-facts-readable',
    generated !== null,
    `the target must ship a complete activated-reference projection at ${REFERENCE_FACTS}`,
  ))
  checks.push(check(
    'plan.reference-sheet-route',
    prose.includes(REFERENCE_SHEET) && prose.includes(REFERENCE_FACTS),
    `the plan must name both ${REFERENCE_SHEET} and its machine-readable ${REFERENCE_FACTS} bundle`,
  ))
  if (generated !== null) {
    checks.push(exactIdentityChecks(
      prose,
      [BULK_ACTION_CAPABILITY, BULK_PROGRESS_CAPABILITY, WORKFLOW_CAPABILITY],
      'plan.required-capability-identities',
      'the plan must name the exact bulk-action, progress, and workflow capability IDs from the canonical inventory',
    ))
    checks.push(exactIdentityChecks(
      prose,
      [BULK_CONTRIBUTION, ...generated.activationIds],
      'plan.contribution-activation-identities',
      'the plan must name the bulk contribution and every activation ID that binds it',
    ))
    checks.push(exactIdentityChecks(
      prose,
      generated.overrideIds,
      'plan.override-target-identities',
      'the plan must name the exact generated override-target IDs for the bulk contribution and its workers',
    ))
    checks.push(exactIdentityChecks(
      prose,
      [WORKFLOW_CONTRIBUTION, generated.specialistRoute, generated.workflowSource],
      'plan.specialist-identities',
      'the plan must name the exact workflow specialist contribution, specialist route, and source',
    ))
    checks.push(exactIdentityChecks(
      prose,
      [...generated.workerIds, 'progressJobId'],
      'plan.bulk-progress-identities',
      'the plan must name both durable workers and their connected progressJobId lifecycle',
    ))
  }

  const sourceReferences = sourceReferenceGrounding(root)
  checks.push(check(
    'plan.source-reference-inventory-readable',
    sourceReferences !== null,
    `the target must expose every required readable source reference in ${SOURCE_LINK_INVENTORY}`,
  ))
  if (sourceReferences !== null) {
    checks.push(exactIdentityChecks(
      prose,
      [...REQUIRED_SOURCE_REFERENCES, ...REQUIRED_DESIGN_REFERENCES],
      'plan.source-reference-identities',
      'the plan must name every exact canonical, gallery, implementation, Figma, and token source-reference ID',
    ))
    checks.push(exactIdentityChecks(
      prose,
      [GALLERY_ITEM_ID, GALLERY_FAMILY_ID, GALLERY_ENTRY_ID],
      'plan.gallery-identities',
      'the UI plan must name the exact gallery item, family, and entry IDs',
    ))
  }

  const designInventoryPath = grounding.inventory?.designSystemInventoryPath
  const designGallery = grounding.inventory?.designSystemGallery
  const designFoundation = grounding.inventory?.designFoundation
  checks.push(check(
    'plan.design-inventory-projection',
    designInventoryPath === '.ai/harness/design-system-inventory.json'
      && designGallery !== null && typeof designGallery === 'object'
      && designFoundation !== null && typeof designFoundation === 'object',
    'the canonical surface inventory must project its generated gallery and design-foundation facts',
  ))
  checks.push(check(
    'plan.ui-design-route',
    prose.includes('om-backend-ui-design')
      && prose.includes('/backend/design-system')
      && /source-only/i.test(prose)
      && /explicit activation/i.test(prose),
    'the UI plan must route through om-backend-ui-design and describe the gallery route as source-only until explicit activation',
  ))
  checks.push(exactIdentityChecks(
    prose,
    [GALLERY_PACKAGE_SHA, FOUNDATION_AUDITED_SHA, FOUNDATION_PACKAGE_SHA, 'publication not-evidenced'],
    'plan.design-provenance',
    'the plan must preserve the gallery and foundation provenance plus the non-publication posture',
  ))
  for (const { id, pattern } of UNSAFE_DESIGN_AUTHORITY_PATTERNS) {
    checks.push(check(`plan.rejects.${id}`, !pattern.test(prose), `the plan must not claim ${id.replaceAll('-', ' ')}`))
  }

  const sections = level2Sections(markdown)
  const traceability = sections.find((section) => TRACEABILITY_HEADING_PATTERN.test(section.heading))
  if (!traceability) {
    checks.push(check('plan.traceability.section', false, 'the plan needs a requirement traceability section'))
    return checks
  }
  const rows = tableRows(traceability.body)
  checks.push(check(
    'plan.traceability.rows',
    rows.length >= contract.minTraceabilityRows,
    `the traceability table needs at least ${contract.minTraceabilityRows} rows, one per added extension surface (found ${rows.length})`,
  ))
  const incomplete = rows.filter((row) => !(
    REQUIREMENT_ID_PATTERN.test(row.text)
    && PHASE_REFERENCE_PATTERN.test(row.text)
    && TEST_IDENTIFIER_PATTERN.test(row.text)
  ))
  checks.push(check(
    'plan.traceability.complete',
    rows.length > 0 && incomplete.length === 0,
    `every traceability row must carry a requirement ID, an implementation phase, and a self-contained integration test (incomplete: ${incomplete.length})`,
  ))
  const classified = rows.map((row) => ({
    row,
    values: MECHANISM_CLASSIFICATIONS.filter((value) => row.text.includes(value)),
  }))
  checks.push(check(
    'plan.traceability.classification',
    rows.length > 0 && classified.every((entry) => entry.values.length === 1),
    `every traceability row must state exactly one mechanism classification from ${MECHANISM_CLASSIFICATIONS.join(', ')}`,
  ))
  checks.push(check(
    'plan.traceability.no-negative-fixture',
    classified.every((entry) => !entry.values.includes(FORBIDDEN_CLASSIFICATION)),
    `no proposed surface may be classified ${FORBIDDEN_CLASSIFICATION}: only a deliberately broken fixture produces it`,
  ))
  const requirementNumbers = rows.map((row) => Number(/\bREQ-(\d{3})\b/.exec(row.text)?.[1]))
  const phaseNumbers = rows.map((row) => Number(/\bPhase\s+(\d+)\b/i.exec(row.text)?.[1]))
  checks.push(check(
    'plan.traceability.ordering',
    rows.length > 0
      && requirementNumbers.every((value, index) => value === index + 1)
      && phaseNumbers.every((value, index) => Number.isInteger(value) && (index === 0 || value >= phaseNumbers[index - 1])),
    'traceability rows must use contiguous requirement IDs and nondecreasing dependency-phase order',
  ))
  if (generated !== null && sourceReferences !== null) {
    const expectedRows = [
      {
        id: 'canonical-data-command',
        values: [
          'data.entities',
          'commands.write',
          REQUIRED_SOURCE_REFERENCES[0],
          REQUIRED_SOURCE_REFERENCES[1],
          'emitted-example',
        ],
      },
      {
        id: 'workflow-specialist',
        values: [WORKFLOW_CAPABILITY, WORKFLOW_CONTRIBUTION, generated.specialistRoute, 'emitted-example'],
      },
      {
        id: 'bulk-action',
        values: [
          BULK_ACTION_CAPABILITY,
          BULK_CONTRIBUTION,
          ...generated.activationIds,
          REQUIRED_SOURCE_REFERENCES[2],
          'emitted-example',
        ],
      },
      {
        id: 'bulk-progress',
        values: [BULK_PROGRESS_CAPABILITY, ...generated.workerIds, ...generated.overrideIds, 'progressJobId', 'emitted-example'],
      },
      {
        id: 'ui-foundation',
        values: [...REQUIRED_DESIGN_REFERENCES, GALLERY_ITEM_ID, GALLERY_PACKAGE_SHA, FOUNDATION_PACKAGE_SHA, 'framework-only'],
      },
    ]
    for (const expected of expectedRows) {
      checks.push(check(
        `plan.traceability.binding.${expected.id}`,
        rows.some((row) => expected.values.every((value) => row.text.includes(value))),
        `one traceability row must bind ${expected.id.replaceAll('-', ' ')} identities, phase, test, and mechanism together`,
      ))
    }
  }
  return checks
}

function newFeatureChecks(root, definition) {
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
  if (definition.moduleShaped) checks.push(...moduleShapedChecks(root, markdown, definition.moduleShaped))
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

function resumeSpecChecks(root, definition) {
  const authored = authoredSpecFiles(root)
  const expected = definition.coveringSpec.slice(`${SPEC_ROOT}/`.length)
  const markdown = readContainedFile(root, definition.coveringSpec)
  const preserved = readContainedFile(root, definition.preservedArtifact)
  const contract = readContainedFile(root, definition.contractArtifact)
  const formatter = readContainedFile(root, definition.formatterArtifact)
  const checks = [
    check(
      'resume.spec.single',
      authored.length === 1 && authored[0] === expected,
      `${definition.coveringSpec} must remain the only authored specification`,
    ),
    check(
      'resume.preserved.unchanged',
      preserved === definition.preservedSource,
      `${definition.preservedArtifact} is verified by the ticked slice and must remain byte-identical`,
    ),
    check(
      'resume.contract.complete',
      contract !== null
        && /export\s+type\s+ExportContract\s*=/.test(contract)
        && /label\s*:\s*string/.test(contract),
      `${definition.contractArtifact} must export ExportContract with a string label`,
    ),
    check(
      'resume.formatter.complete',
      formatter !== null
        && /import\s+type\s*\{\s*ExportContract\s*\}\s+from\s+['"]\.\/export-contract['"]/.test(formatter)
        && /formatExport\s*\(\s*label\s*:\s*string\s*\)\s*:\s*ExportContract/.test(formatter)
        && /label\s*:\s*label\.trim\(\)/.test(formatter),
      `${definition.formatterArtifact} must consume the paired contract and normalize a string label`,
    ),
  ]
  if (markdown === null) {
    checks.push(check('resume.ledger.readable', false, `${definition.coveringSpec} must remain readable`))
    return checks
  }
  checks.push(
    check('resume.ledger.progress', /^Progress:\s*2\/2\s*$/m.test(markdown), 'the canonical ledger must report Progress: 2/2'),
    check(
      'resume.ledger.preserved-slice',
      /^- \[x\] Slice 1 .*verified: `yarn typecheck --pretty false`$/m.test(markdown),
      'the previously verified first slice must stay ticked with its original evidence',
    ),
    check(
      'resume.ledger.completed-slice',
      /^- \[x\] Slice 2 .*verified: `yarn typecheck --pretty false`$/m.test(markdown),
      'the resumed slice must be ticked only with exact focused verification evidence',
    ),
    check('resume.ledger.no-in-flight', !/\bIN FLIGHT\b/.test(markdown), 'a completed slice must clear its temporary IN FLIGHT marker'),
  )
  return checks
}

export function evaluateWritableSpecOracle({ root: requestedRoot, caseId, phase }) {
  if (typeof requestedRoot !== 'string' || !path.isAbsolute(requestedRoot)) throw new Error('root must be absolute')
  const definition = SPEC_CASES[caseId]
  if (!definition) throw new Error(`unsupported writable spec case: ${caseId}`)
  if (!['before', 'after'].includes(phase)) throw new Error('phase must be before or after')
  const root = fs.realpathSync(requestedRoot)
  const contractChecks = definition.kind === 'new-feature'
    ? newFeatureChecks(root, definition)
    : definition.kind === 'existing-spec'
      ? existingSpecChecks(root, definition)
      : resumeSpecChecks(root, definition)
  const checks = [
    ...contractChecks,
    ...reservedSpecChecks(root),
    ...(definition.kind === 'resume' ? [] : implementationChecks(root, definition)),
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
