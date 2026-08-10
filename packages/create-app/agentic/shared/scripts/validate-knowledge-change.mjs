#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXIT_PASS = 0
const EXIT_FAILURE = 1
const EXIT_INVALID = 2

export const CHANGE_CLASSES = Object.freeze(['knowledge-contract', 'asset-sync'])
export const CHANGED_CONTRACTS = Object.freeze([
  'routing', 'skill-link', 'source-link', 'example-source', 'installed-source',
  'discovery', 'context-read', 'evaluator', 'oracle',
])
export const RELEASE_LANE_IDS = Object.freeze([
  'deterministic', 'routing', 'writable', 'generatedCodeReview', 'generativeJudge', 'generatedTests',
])
export const CONTROLLER_OWNED_FIELDS = Object.freeze(['resolvedBaseSha', 'headSha', 'focusedExecutions'])
export const SCHEMA_BASENAME = 'knowledge-change.schema.json'

// Sibling of the baseline and topics registry, which live OUTSIDE the shipped
// `agentic/shared/**` tree on purpose: that tree is copied wholesale into every generated
// app, and these are monorepo-only assets (the baseline pins monorepo SHAs and validates
// monorepo files). A forward reference to the old location would have sent the inventory
// back into every scaffold when it lands.
export const SOURCE_LINK_INVENTORY_PATH =
  'packages/create-app/scripts/source-links/source-link-inventory.json'
// The spec's finite `main` parity ledger ships as `source-link-baseline.json`. Its path is pinned
// here rather than read out of the inventory's `inputs.baseline`, because that string lives inside
// an asset the same author is editing: anchoring the manifest to it would let an author point both
// at a ledger they fabricated. The inventory may now only agree with this literal or fail.
// `validate-source-links.mjs` hardcodes the same path for the same reason.
export const SOURCE_LINK_BASELINE_PATH =
  'packages/create-app/scripts/source-links/source-link-baseline.json'
// The schema pinning that ledger's shape is the ledger's exact sibling, so `baselineSchemaPath` is
// derived from the pinned ledger path rather than spelled out a second time.
export const SOURCE_LINK_BASELINE_SCHEMA_BASENAME = 'source-link-baseline.schema.json'
export const CANON_C_REASON =
  `${SOURCE_LINK_INVENTORY_PATH} not present — CANON-C (canonical-example source-link inventory) is a ` +
  'monorepo-only asset and is absent from this tree, so source-link, example-source, and ' +
  'installed-source contracts cannot be resolved and fail closed'

const EXAMPLE_AUTHORING_ROOT = 'apps/mercato/src/modules/example'
const EXAMPLE_TEMPLATE_ROOT = 'packages/create-app/template/src/modules/example'
const EXAMPLE_QA_ONLY_SEGMENTS = Object.freeze(['__tests__', '__integration__'])

/**
 * Pinned exactly the way `SOURCE_LINK_INVENTORY_PATH` is. The capability inventory is an asset the
 * same author edits, so no string in the manifest — or inside the inventory itself — may decide
 * which file this gate reads.
 */
const EXAMPLE_SURFACE_INVENTORY_PATH = `${EXAMPLE_AUTHORING_ROOT}/references/surface-inventory.json`

/**
 * Inventory rows address files the way the emitted app sees them (`src/modules/example/...`), not
 * the way the monorepo does, so every path out of that asset resolves against the owning app root
 * rather than the repository root. Resolving from the repository root instead makes all 66 shipped
 * declarations look missing.
 */
const EXAMPLE_APP_ROOT = EXAMPLE_AUTHORING_ROOT.slice(0, EXAMPLE_AUTHORING_ROOT.indexOf('/src/'))

const FOCUSED_TEST_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/

// One argv token may not carry a shell metacharacter. The controller never interpolates a shell,
// and the recorded evidence must stay reproducible as an exact argv vector.
const SHELL_METACHARACTER_PATTERN = /[`$;&|<>\n]/

export const DEFAULT_EXECUTION_TIMEOUT_MS = 600_000

// Ordered; the first matching runner owns the focused test. Runner argv is controller-derived so an
// author can never substitute a weaker command for the test they declared.
const FOCUSED_RUNNERS = Object.freeze([
  { runner: 'node-test', pattern: /\.(?:test|spec)\.[cm]?jsx?$/, args: (relativePath) => ['--test', relativePath] },
  { runner: 'node-test-tsx', pattern: /\.(?:test|spec)\.[cm]?tsx?$/, args: (relativePath) => ['--import', 'tsx', '--test', relativePath] },
])

// Ordered; the first matching rule owns the path. `contract: null` marks a path that
// carries no knowledge contract of its own — a generated/materialized copy or a docs
// snapshot — which is the only shape an `asset-sync` run may contain.
const CLASSIFICATION_RULES = Object.freeze([
  {
    rule: 'canonical-example-tree',
    contract: 'example-source',
    changeClass: 'knowledge-contract',
    pattern: /^(?:apps\/mercato\/src|packages\/create-app\/template\/src|src)\/modules\/example\/.+$/,
  },
  {
    // The derived inventory, the topic registry it derives from, the finite `main` parity ledger
    // (`source-link-baseline.json` — the spec names it a parity ledger, it ships under this name),
    // and the schema pinning that ledger's shape.
    rule: 'source-link-inventory',
    contract: 'source-link',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)(?:source-link-inventory\.json|source-link-topics\.json|source-link-baseline\.json|source-link-baseline\.schema\.json)$/,
  },
  {
    rule: 'installed-package-manifest',
    contract: 'installed-source',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)(?:package\.json|package\.json\.template|yarn\.lock|package-lock\.json|pnpm-lock\.yaml)$/,
  },
  {
    rule: 'installed-skill-closure',
    contract: 'installed-source',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)skills\/tiers\.json$/,
  },
  {
    rule: 'evaluator-implementation',
    contract: 'evaluator',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)scripts\/(?:evaluate-agent-harness|agent-harness-tool-server|run-agent-harness-release|prepare-agent-harness-fixture|execution-sandbox|framework-context|validate-knowledge-change)\.mjs$/,
  },
  {
    rule: 'writable-oracle',
    contract: 'oracle',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)harness\/(?:writable-ast-oracles\.mjs|writable-behavior-oracles\.mjs|validators\.json)$/,
  },
  {
    rule: 'case-context-policy',
    contract: 'context-read',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)harness\/(?:cases\.json|release-matrix\.json|fixtures\/.+|[^/]+\.schema\.json)$/,
  },
  {
    rule: 'agent-instruction-owner',
    contract: 'routing',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)(?:AGENTS\.md|AGENTS\.md\.template|CLAUDE\.md|CLAUDE\.md\.template)$/,
  },
  {
    rule: 'generated-fact-copy',
    contract: null,
    changeClass: 'asset-sync',
    pattern: /(?:^|\/)(?:\.ai|ai)\/guides\/(?:modules|upstream)\/.+$/,
  },
  {
    rule: 'routing-guide-owner',
    contract: 'routing',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)(?:\.ai|ai)\/guides\/[^/]+\.md$/,
  },
  {
    rule: 'skill-authority',
    contract: 'skill-link',
    changeClass: 'knowledge-contract',
    pattern: /(?:^|\/)skills\/(?:[^/]+\/(?:SKILL\.md|references\/.+|scripts\/.+)|tiers\.schema\.json)$/,
  },
  {
    rule: 'discovery-generator-contract',
    contract: 'discovery',
    changeClass: 'knowledge-contract',
    pattern: /^(?:packages\/cli\/src\/lib\/generators\/.+|packages\/create-app\/src\/setup\/.+|packages\/create-app\/build\.mjs)$/,
  },
  {
    rule: 'materialized-copy',
    contract: null,
    changeClass: 'asset-sync',
    pattern: /^(?:packages\/create-app\/dist\/.+|apps\/docs\/.+|\.ai\/specs\/.+\.md)$/,
  },
  {
    rule: 'docs-count-snapshot',
    contract: null,
    changeClass: 'asset-sync',
    pattern: /(?:^|\/)(?:README\.md|RELEASE\.md|CHANGELOG\.md)$/,
  },
  {
    rule: 'focused-test',
    contract: 'evaluator',
    changeClass: 'knowledge-contract',
    pattern: FOCUSED_TEST_PATTERN,
  },
])

export function normalizeRelativePath(value) {
  return String(value ?? '').split('\\').join('/').replace(/^\.\//, '')
}

export function isFocusedTestPath(value) {
  return FOCUSED_TEST_PATTERN.test(normalizeRelativePath(value))
}

export function classifyChangedPath(value) {
  const relativePath = normalizeRelativePath(value)
  for (const rule of CLASSIFICATION_RULES) {
    if (!rule.pattern.test(relativePath)) continue
    return {
      path: relativePath,
      rule: rule.rule,
      contract: rule.contract,
      changeClass: rule.changeClass,
      focusedTest: isFocusedTestPath(relativePath),
    }
  }
  return {
    path: relativePath,
    rule: 'unclassified-fails-closed',
    contract: null,
    changeClass: 'knowledge-contract',
    focusedTest: false,
  }
}

export function deriveChangeClassification(paths) {
  const records = [...new Set((paths ?? []).map(normalizeRelativePath))].sort().map(classifyChangedPath)
  const contracts = new Set()
  let changeClass = 'asset-sync'
  for (const record of records) {
    if (record.contract) contracts.add(record.contract)
    if (record.changeClass === 'knowledge-contract') changeClass = 'knowledge-contract'
  }
  return {
    changeClass,
    changedContracts: CHANGED_CONTRACTS.filter((contract) => contracts.has(contract)),
    records,
    unclassifiedPaths: records.filter((record) => record.rule === 'unclassified-fails-closed').map((record) => record.path),
    focusedTestPaths: records.filter((record) => record.focusedTest).map((record) => record.path),
  }
}

function resolveSchemaReference(rootSchema, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return null
  let node = rootSchema
  for (const rawSegment of reference.slice(2).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, segment)) return null
    node = node[segment]
  }
  return node
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesSchemaType(value, type) {
  if (type === 'object') return isPlainObject(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'null') return value === null
  return false
}

export function validateJsonSchema(value, schema, location = '$', rootSchema = schema) {
  if (schema === true) return []
  if (schema === false) return [`${location} is not allowed by its schema`]
  const errors = []
  if (schema.$ref) {
    const resolved = resolveSchemaReference(rootSchema, schema.$ref)
    if (!resolved) return [`${location} has an unresolved schema reference ${schema.$ref}`]
    errors.push(...validateJsonSchema(value, resolved, location, rootSchema))
  }
  for (const branch of schema.allOf ?? []) errors.push(...validateJsonSchema(value, branch, location, rootSchema))
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => validateJsonSchema(value, branch, location, rootSchema).length === 0)) {
    errors.push(`${location} does not match any allowed schema branch`)
  }
  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter((branch) => validateJsonSchema(value, branch, location, rootSchema).length === 0)
    if (matched.length !== 1) errors.push(`${location} must match exactly one schema branch`)
  }
  if (Object.hasOwn(schema, 'not') && validateJsonSchema(value, schema.not, location, rootSchema).length === 0) {
    errors.push(`${location} matches a forbidden schema branch${schema.description ? `: ${schema.description}` : ''}`)
  }
  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (expectedTypes.length && !expectedTypes.some((type) => matchesSchemaType(value, type))) {
    errors.push(`${location} must be ${expectedTypes.join(' or ')}`)
    return errors
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(`${location} must equal its schema constant`)
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    errors.push(`${location} is not in its schema enum`)
  }
  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${location} is below minLength ${schema.minLength}`)
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) errors.push(`${location} exceeds maxLength ${schema.maxLength}`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location} does not match its schema pattern`)
  }
  if (typeof value === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${location} is below minimum ${schema.minimum}`)
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${location} exceeds maximum ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${location} is below minItems ${schema.minItems}`)
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${location} exceeds maxItems ${schema.maxItems}`)
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${location} must contain unique items`)
    if (schema.items) value.forEach((item, index) => errors.push(...validateJsonSchema(item, schema.items, `${location}[${index}]`, rootSchema)))
  }
  if (isPlainObject(value)) {
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) errors.push(`${location}.${required} is required`)
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${location}.${key} is not allowed`)
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...validateJsonSchema(value[key], childSchema, `${location}.${key}`, rootSchema))
    }
  }
  return errors
}

function hashFile(absolutePath) {
  return createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex')
}

function isRegularFile(absolutePath) {
  try { return fs.statSync(absolutePath).isFile() } catch { return false }
}

function readJsonIfPresent(absolutePath) {
  if (!isRegularFile(absolutePath)) return null
  try { return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) } catch { return null }
}

export function expandCaseRange(rangeId) {
  const match = /^OMH-([0-9]{3})\.\.OMH-([0-9]{3})$/.exec(String(rangeId ?? ''))
  if (!match) return null
  const low = Number(match[1])
  const high = Number(match[2])
  if (low > high) return null
  const ids = []
  for (let index = low; index <= high; index += 1) ids.push(`OMH-${String(index).padStart(3, '0')}`)
  return ids
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return result.stdout
}

export function resolveGitSha(root, ref) {
  return git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
}

export function deriveChangedPaths(root, baseSha) {
  const tracked = git(root, ['diff', '--name-only', '--no-renames', baseSha]).split('\n')
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).split('\n')
  return [...new Set([...tracked, ...untracked].map((line) => line.trim()).filter(Boolean).map(normalizeRelativePath))].sort()
}

function exampleMirrorPath(relativePath) {
  if (relativePath.startsWith(`${EXAMPLE_AUTHORING_ROOT}/`)) {
    return `${EXAMPLE_TEMPLATE_ROOT}/${relativePath.slice(EXAMPLE_AUTHORING_ROOT.length + 1)}`
  }
  if (relativePath.startsWith(`${EXAMPLE_TEMPLATE_ROOT}/`)) {
    return `${EXAMPLE_AUTHORING_ROOT}/${relativePath.slice(EXAMPLE_TEMPLATE_ROOT.length + 1)}`
  }
  return null
}

export function exampleReadStatus(relativePath) {
  const segments = normalizeRelativePath(relativePath).split('/')
  return segments.some((segment) => EXAMPLE_QA_ONLY_SEGMENTS.includes(segment)) ? 'qa-only' : 'readable'
}

function checkExampleSourceMirrors(root, records, errors, derived) {
  const mirrors = []
  for (const record of records) {
    if (record.contract !== 'example-source') continue
    const mirror = exampleMirrorPath(record.path)
    if (!mirror) continue
    const sourceAbsolute = path.join(root, record.path)
    const mirrorAbsolute = path.join(root, mirror)
    const sourceExists = isRegularFile(sourceAbsolute)
    const mirrorExists = isRegularFile(mirrorAbsolute)
    const entry = { path: record.path, mirrorPath: mirror, readStatus: exampleReadStatus(record.path) }
    if (!sourceExists && !mirrorExists) {
      entry.state = 'deleted-on-both-sides'
    } else if (!sourceExists || !mirrorExists) {
      entry.state = 'mirror-missing'
      errors.push(
        `example-source ${record.path} was moved or deleted without its byte-identical mirror ${mirror}; ` +
        'run `yarn template:sync:fix` and update the surface inventory',
      )
    } else if (hashFile(sourceAbsolute) !== hashFile(mirrorAbsolute)) {
      entry.state = 'mirror-drift'
      errors.push(`example-source ${record.path} is not byte-identical to its mirror ${mirror}; run \`yarn template:sync:fix\``)
    } else {
      entry.state = 'mirrored'
      entry.sha256 = hashFile(sourceAbsolute)
    }
    mirrors.push(entry)
  }
  derived.exampleSourceMirrors = mirrors
}

function checkFileRecords(root, label, records, errors, options = {}) {
  for (const record of records) {
    const absolute = path.join(root, record.path)
    if (!isRegularFile(absolute)) {
      errors.push(`${label} ${record.path} is not an exact regular file in the working tree`)
      continue
    }
    const actual = hashFile(absolute)
    if (actual !== record.sha256) {
      errors.push(`${label} ${record.path} sha256 is stale: manifest ${record.sha256}, working tree ${actual}`)
    }
    if (!options.sourcePathRequired) continue
    const sourceAbsolute = path.join(root, record.sourcePath)
    if (!isRegularFile(sourceAbsolute)) {
      errors.push(`${label} ${record.path} names sourcePath ${record.sourcePath}, which is not an exact regular file`)
    }
  }
}

/**
 * Re-derive the source-link facts a run manifest declares, from the inventory's own records
 * rather than from its summary block: an author who edits the summary must not be able to
 * make a wrong declaration agree with it.
 */
export function deriveSourceLinkInventoryFacts(inventory) {
  const records = isPlainObject(inventory) && Array.isArray(inventory.records) ? inventory.records : null
  if (records === null) return null
  return {
    ownerCount: new Set(records.map((record) => record?.originAsset)).size,
    topicCount: new Set(records.map((record) => record?.topicId)).size,
    resolvedLinkCount: records.reduce(
      (total, record) => total + (Number.isInteger(record?.renderedLinkCount) ? record.renderedLinkCount : 0),
      0,
    ),
    declaredBaselinePath: typeof inventory.inputs?.baseline === 'string' ? inventory.inputs.baseline : null,
  }
}

const EMPTY_BASELINE_FACTS = Object.freeze({
  baselineAssetCount: null,
  baselineDispositionCount: null,
  baselineSha: null,
})

export function deriveSourceLinkBaselineFacts(baseline) {
  if (!isPlainObject(baseline)) return null
  return {
    baselineAssetCount: Array.isArray(baseline.baselineAssets) ? baseline.baselineAssets.length : null,
    baselineDispositionCount: Array.isArray(baseline.blocks) ? baseline.blocks.length : null,
    baselineSha: typeof baseline.baselineSha === 'string' ? baseline.baselineSha : null,
  }
}

function siblingPath(relativePath, basename) {
  const segments = normalizeRelativePath(relativePath).split('/')
  segments[segments.length - 1] = basename
  return segments.join('/')
}

/**
 * A minimal, schema-valid parity ledger. It is never written anywhere: it exists only so the
 * declared ledger schema can be probed before the real ledger is trusted to it.
 */
const BASELINE_SCHEMA_PROBE_LEDGER = Object.freeze({
  baselineSha: '0'.repeat(40),
  baselineAssets: [{ path: 'AGENTS.md', sha256: '1'.repeat(64), expectedFenceCount: 1 }],
  blocks: [{
    id: 'main:AGENTS.md#fence:1',
    asset: 'AGENTS.md',
    ordinal: 1,
    heading: null,
    openingLine: '```ts',
    info: 'ts',
    contentSha256: '2'.repeat(64),
    topicIds: [],
    disposition: 'linked',
  }],
})

function probeLedger(mutate) {
  const ledger = structuredClone(BASELINE_SCHEMA_PROBE_LEDGER)
  mutate(ledger)
  return ledger
}

/**
 * The clauses the gate relies on, each as a ledger the schema must reject. They are a readable
 * checklist of what the pinned schema is trusted to assert — and a second line of defence for the
 * one moment the SHA pin below is open, namely a change that legitimately updates the pin: guttings
 * that the new bytes would smuggle in still have to survive every probe.
 */
export const BASELINE_SCHEMA_PROBES = Object.freeze([
  ['a non-hex baselineSha', probeLedger((ledger) => { ledger.baselineSha = 'not-a-commit' })],
  ['a ledger missing its blocks array', probeLedger((ledger) => { delete ledger.blocks })],
  ['a ledger missing its baselineAssets array', probeLedger((ledger) => { delete ledger.baselineAssets })],
  ['an undeclared top-level ledger field', probeLedger((ledger) => { ledger.supersededBy = 'anything' })],
  ['an absolute baseline asset path', probeLedger((ledger) => { ledger.baselineAssets[0].path = '/etc/passwd' })],
  ['a parent-traversal baseline asset path', probeLedger((ledger) => { ledger.baselineAssets[0].path = '../outside.md' })],
  ['a baseline asset missing its sha256', probeLedger((ledger) => { delete ledger.baselineAssets[0].sha256 })],
  ['a baseline asset missing its expectedFenceCount', probeLedger((ledger) => { delete ledger.baselineAssets[0].expectedFenceCount })],
  ['a non-hex baseline asset sha256', probeLedger((ledger) => { ledger.baselineAssets[0].sha256 = 'not-a-hash' })],
  ['an undeclared baseline asset field', probeLedger((ledger) => { ledger.baselineAssets[0].note = 'anything' })],
  ['a parent-traversal block asset path', probeLedger((ledger) => { ledger.blocks[0].asset = '../outside.md' })],
  ['a block id that is not main:<asset>#fence:<ordinal>', probeLedger((ledger) => { ledger.blocks[0].id = 'AGENTS.md:1' })],
  ['a block missing its contentSha256', probeLedger((ledger) => { delete ledger.blocks[0].contentSha256 })],
  ['a block missing its topicIds', probeLedger((ledger) => { delete ledger.blocks[0].topicIds })],
  ['a block missing its disposition', probeLedger((ledger) => { delete ledger.blocks[0].disposition })],
  ['a block missing its ordinal', probeLedger((ledger) => { delete ledger.blocks[0].ordinal })],
  ['a non-integer block ordinal', probeLedger((ledger) => { ledger.blocks[0].ordinal = '1' })],
  ['a non-hex block contentSha256', probeLedger((ledger) => { ledger.blocks[0].contentSha256 = 'not-a-hash' })],
  ['an invented block disposition', probeLedger((ledger) => { ledger.blocks[0].disposition = 'invented-disposition' })],
  ['an undeclared block field', probeLedger((ledger) => { ledger.blocks[0].supersededBy = 'anything' })],
  ['repeated block topic IDs', probeLedger((ledger) => { ledger.blocks[0].topicIds = ['guides/a:one.ts', 'guides/a:one.ts'] })],
])

export const SOURCE_LINK_BASELINE_SCHEMA_ID = 'https://open-mercato.dev/schemas/source-link-baseline.schema.json'

/**
 * The exact bytes of `source-link-baseline.schema.json`. Behavioural probing alone is not a pin:
 * this engine supports `anyOf`/`oneOf`/`not`, so a schema carrying the pinned `$id`, the real body in
 * one branch and an escape branch no probe ever matches passes every probe while accepting a lawless
 * ledger. Pinning the file itself is what makes "a gutted or swapped schema fails the run" true, and
 * pinning a baseline by SHA is what the rest of this subsystem already does — `source-link-baseline.json`
 * pins eight asset SHAs the same way. Updating this constant when the schema legitimately changes is
 * the normal path: that edit lands in the `evaluator` contract, not in the `source-link` assets under
 * audit, so it can never be made by the ledger change it would be waving through.
 * Recompute with `sha256sum packages/create-app/scripts/source-links/source-link-baseline.schema.json`.
 */
export const SOURCE_LINK_BASELINE_SCHEMA_SHA256 =
  'b1ce4c0845b078b317cd0f699921628a2c23edb7271c883d0597de73dd401cc8'

/**
 * Prove the declared schema is the pinned one and still asserts what the gate relies on. Returns the
 * reasons it is not; a non-empty result means the ledger must not be validated against it.
 */
export function baselineSchemaPinErrors(baselineSchema, schemaSha256) {
  const reasons = []
  if (schemaSha256 !== SOURCE_LINK_BASELINE_SCHEMA_SHA256) {
    reasons.push(
      `its sha256 is ${JSON.stringify(schemaSha256 ?? null)} rather than the pinned ${SOURCE_LINK_BASELINE_SCHEMA_SHA256}`,
    )
  }
  if (!isPlainObject(baselineSchema)) {
    reasons.push('it is not a JSON schema object')
    return reasons
  }
  if (baselineSchema.$id !== SOURCE_LINK_BASELINE_SCHEMA_ID) {
    reasons.push(`its $id is ${JSON.stringify(baselineSchema.$id)} rather than ${SOURCE_LINK_BASELINE_SCHEMA_ID}`)
  }
  const acceptErrors = validateJsonSchema(BASELINE_SCHEMA_PROBE_LEDGER, baselineSchema, '$', baselineSchema)
  if (acceptErrors.length) reasons.push(`it rejects a canonical minimal ledger: ${acceptErrors.join('; ')}`)
  for (const [label, ledger] of BASELINE_SCHEMA_PROBES) {
    if (!validateJsonSchema(ledger, baselineSchema, '$', baselineSchema).length) reasons.push(`it accepts ${label}`)
  }
  return reasons
}

/**
 * `uniqueItems` compares whole serialized records, so two blocks sharing an `id` and differing in
 * any other field satisfy it. Block IDs are the ledger's join key, so uniqueness is checked here
 * rather than left to a schema vocabulary that cannot express it.
 */
function duplicateBlockIds(baseline) {
  const seen = new Set()
  const duplicates = new Set()
  for (const block of Array.isArray(baseline?.blocks) ? baseline.blocks : []) {
    if (typeof block?.id !== 'string') continue
    if (seen.has(block.id)) duplicates.add(block.id)
    seen.add(block.id)
  }
  return [...duplicates].sort()
}

function checkDeclaredCount(errors, field, declared, actual, subject) {
  if (!Number.isInteger(declared) || declared === actual) return
  errors.push(`sourceLinkInventory.${field} declares ${declared}, but ${subject} resolves ${actual}`)
}

/**
 * Enforce every field of the manifest's `sourceLinkInventory` block against the checked assets it
 * names. Declaring a count is worthless unless the count is compared with the real one, so each
 * field is re-derived here: owners, topics and rendered links from the inventory records, assets,
 * dispositions and the pinned baseline SHA from the parity ledger, and the ledger's whole shape
 * from the schema the manifest names.
 */
function checkSourceLinkInventory(root, declared, errors, derived) {
  const declaredInventoryPath = declared?.path
  if (typeof declaredInventoryPath === 'string' && declaredInventoryPath !== SOURCE_LINK_INVENTORY_PATH) {
    errors.push(`sourceLinkInventory.path must be ${SOURCE_LINK_INVENTORY_PATH}`)
  }
  const inventoryPath = typeof declaredInventoryPath === 'string' ? declaredInventoryPath : SOURCE_LINK_INVENTORY_PATH
  if (!isRegularFile(path.join(root, inventoryPath))) {
    derived.sourceLinkInventoryStatus = 'absent'
    errors.push(CANON_C_REASON)
    return
  }
  derived.sourceLinkInventoryStatus = 'present'

  const inventoryFacts = deriveSourceLinkInventoryFacts(readJsonIfPresent(path.join(root, inventoryPath)))
  if (inventoryFacts === null) {
    errors.push(`sourceLinkInventory.path ${inventoryPath} is not a readable inventory: it carries no records array`)
    return
  }
  derived.sourceLinkInventoryFacts = { ...inventoryFacts, ...EMPTY_BASELINE_FACTS }
  checkDeclaredCount(errors, 'expectedOwnerCount', declared.expectedOwnerCount, inventoryFacts.ownerCount, `${inventoryPath} distinct originAsset owners`)
  checkDeclaredCount(errors, 'expectedTopicCount', declared.expectedTopicCount, inventoryFacts.topicCount, `${inventoryPath} distinct topic IDs`)
  checkDeclaredCount(errors, 'resolvedLinkCount', declared.resolvedLinkCount, inventoryFacts.resolvedLinkCount, `${inventoryPath} rendered links`)

  if (inventoryFacts.declaredBaselinePath !== SOURCE_LINK_BASELINE_PATH) {
    errors.push(
      `sourceLinkInventory: ${inventoryPath} declares inputs.baseline `
      + `${JSON.stringify(inventoryFacts.declaredBaselinePath)}, but the parity ledger is pinned to `
      + `${SOURCE_LINK_BASELINE_PATH}, so no asset under audit may redirect which ledger is checked`,
    )
    return
  }
  const declaredBaselinePath = declared?.baselinePath
  if (typeof declaredBaselinePath !== 'string') return
  if (declaredBaselinePath !== SOURCE_LINK_BASELINE_PATH) {
    errors.push(`sourceLinkInventory.baselinePath must be ${SOURCE_LINK_BASELINE_PATH}`)
    return
  }
  if (!isRegularFile(path.join(root, declaredBaselinePath))) {
    errors.push(`sourceLinkInventory.baselinePath ${declaredBaselinePath} is not an exact regular file in the working tree`)
    return
  }
  const baseline = readJsonIfPresent(path.join(root, declaredBaselinePath))
  const baselineFacts = deriveSourceLinkBaselineFacts(baseline)
  if (baselineFacts === null) {
    errors.push(`sourceLinkInventory.baselinePath ${declaredBaselinePath} is not a readable JSON object`)
    return
  }
  derived.sourceLinkInventoryFacts = { ...inventoryFacts, ...baselineFacts }
  const repeatedBlockIds = duplicateBlockIds(baseline)
  if (repeatedBlockIds.length) {
    errors.push(`sourceLinkInventory ${declaredBaselinePath} repeats block ids: ${repeatedBlockIds.join(', ')}`)
  }
  checkDeclaredCount(errors, 'baselineAssetCount', declared.baselineAssetCount, baselineFacts.baselineAssetCount, `${declaredBaselinePath} pinned assets`)
  checkDeclaredCount(
    errors,
    'baselineDispositionCount',
    declared.baselineDispositionCount,
    baselineFacts.baselineDispositionCount,
    `${declaredBaselinePath} disposition records`,
  )
  if (typeof declared.baselineRef === 'string' && declared.baselineRef !== baselineFacts.baselineSha) {
    errors.push(
      `sourceLinkInventory.baselineRef declares ${declared.baselineRef}, but ${declaredBaselinePath} pins `
      + `${String(baselineFacts.baselineSha)}`,
    )
  }

  const expectedSchemaPath = siblingPath(SOURCE_LINK_BASELINE_PATH, SOURCE_LINK_BASELINE_SCHEMA_BASENAME)
  const declaredSchemaPath = declared?.baselineSchemaPath
  if (typeof declaredSchemaPath !== 'string') return
  if (declaredSchemaPath !== expectedSchemaPath) {
    errors.push(`sourceLinkInventory.baselineSchemaPath declares ${declaredSchemaPath}, but the ledger's schema is ${expectedSchemaPath}`)
    return
  }
  const schemaAbsolutePath = path.join(root, declaredSchemaPath)
  if (!isRegularFile(schemaAbsolutePath)) {
    errors.push(`sourceLinkInventory.baselineSchemaPath ${declaredSchemaPath} is not an exact regular file in the working tree`)
    return
  }
  const baselineSchema = readJsonIfPresent(schemaAbsolutePath)
  const pinErrors = baselineSchemaPinErrors(baselineSchema, hashFile(schemaAbsolutePath))
  if (pinErrors.length) {
    for (const reason of pinErrors) {
      errors.push(`sourceLinkInventory.baselineSchemaPath ${declaredSchemaPath} no longer pins the ledger contract: ${reason}`)
    }
    return
  }
  for (const error of validateJsonSchema(baseline, baselineSchema, '$', baselineSchema)) {
    errors.push(`sourceLinkInventory ${declaredBaselinePath} violates ${declaredSchemaPath}: ${error}`)
  }
}

/**
 * Reads the capability rows out of the canonical example's `surface-inventory.json`. Returns
 * `null` — never an empty list — when the asset is unreadable or misshapen, so a caller cannot
 * mistake "could not read it" for "it declares nothing" and pass a change that should fail closed.
 */
export function readExampleCapabilityRows(inventory) {
  if (!isPlainObject(inventory) || !Array.isArray(inventory.capabilities)) return null
  return inventory.capabilities.filter(isPlainObject)
}

/**
 * The CANON gate, derived rather than declared — spec
 * `.ai/specs/2026-07-31-standalone-canonical-example-module.md`: "Any future added/materially
 * changed runtime or discovery surface with `coverageKind: "example"` is rejected unless it
 * declares its focused integration-test paths and dependency modules."
 *
 * The manifest deliberately carries no field for this. A declared field would be a waiver surface,
 * and the spec is explicit that a manifest cannot waive a required surface — so the rows are read
 * from the pinned inventory and compared against the same inventory at the base commit.
 *
 * Three separable failures, because they rot in different ways:
 *   1. a declared path that is not a test file, or does not exist (declaration decays into fiction);
 *   2. a NEW example capability row that declares no integration coverage (the gate itself);
 *   3. a row that HAD coverage and dropped it (the ratchet — silent coverage loss).
 *
 * `baseRows` of `null` means the inventory did not exist at the base commit, so every row is new.
 */
export function exampleCoverageErrors(headRows, baseRows, options = {}) {
  const errors = []
  const pathExists = options.pathExists ?? (() => true)
  if (headRows === null) {
    errors.push(
      `${EXAMPLE_SURFACE_INVENTORY_PATH} is missing or carries no "capabilities" array, so declared ` +
      'integration coverage for the canonical example cannot be verified and fails closed',
    )
    return errors
  }

  const baseCoverage = new Map()
  for (const row of baseRows ?? []) {
    if (typeof row.capabilityId !== 'string') continue
    baseCoverage.set(row.capabilityId, Array.isArray(row.integrationTestPaths) ? row.integrationTestPaths.length : 0)
  }

  for (const row of headRows) {
    const id = typeof row.capabilityId === 'string' ? row.capabilityId : '(unnamed row)'
    if (row.coverageKind !== 'example') continue

    if (!Array.isArray(row.integrationTestPaths)) {
      errors.push(`surface-inventory ${id} has no integrationTestPaths array`)
      continue
    }
    if (!Array.isArray(row.dependencyModules)) {
      errors.push(`surface-inventory ${id} has no dependencyModules array`)
    }

    for (const testPath of row.integrationTestPaths) {
      const normalized = normalizeRelativePath(String(testPath))
      if (!isFocusedTestPath(normalized)) {
        errors.push(`surface-inventory ${id} declares ${normalized}, which is not a focused test file`)
        continue
      }
      if (!pathExists(normalized)) {
        errors.push(`surface-inventory ${id} declares ${normalized}, which is not a file in the working tree`)
      }
    }

    const declaredNow = row.integrationTestPaths.length
    const hasSource = Array.isArray(row.sourcePaths) && row.sourcePaths.length > 0
    if (!baseCoverage.has(id)) {
      if (hasSource && declaredNow === 0) {
        errors.push(
          `surface-inventory ${id} is a new coverageKind:"example" capability with source paths but ` +
          'declares no integrationTestPaths; a new example surface must name its own integration coverage',
        )
      }
      continue
    }
    const declaredBefore = baseCoverage.get(id)
    if (declaredBefore > 0 && declaredNow === 0) {
      errors.push(
        `surface-inventory ${id} declared ${declaredBefore} integration test(s) at the base commit and now ` +
        'declares none; declared coverage may not be dropped',
      )
    }
  }
  return errors
}

function baseFileHash(root, baseSha, relativePath) {
  const result = spawnSync('git', ['-C', root, 'show', `${baseSha}:${relativePath}`], { encoding: 'buffer' })
  if (result.status !== 0) return null
  return createHash('sha256').update(result.stdout).digest('hex')
}

function baseFileBuffer(root, baseSha, relativePath) {
  const result = spawnSync('git', ['-C', root, 'show', `${baseSha}:${relativePath}`], { encoding: 'buffer' })
  return result.status === 0 ? result.stdout : null
}

const NODE_TEST_SCRIPT_PATTERN = /(?:^|\s)--test(?:[=\s]|$)/

/**
 * The controller only drives an exact `node --test` argv. It reads the nearest owning package's
 * declared test script so a project on another runner is refused with its real script name instead
 * of being handed a command that would not run its suite.
 */
export function resolveTestRunnerFamily(root, testFile) {
  const segments = normalizeRelativePath(testFile).split('/').slice(0, -1)
  const directories = ['']
  let accumulated = ''
  for (const segment of segments) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment
    directories.push(accumulated)
  }
  for (const directory of directories.reverse()) {
    const manifest = readJsonIfPresent(path.join(root, directory, 'package.json'))
    const declared = manifest?.scripts?.test
    if (typeof declared !== 'string' || !declared.trim()) continue
    return NODE_TEST_SCRIPT_PATTERN.test(declared)
      ? { family: 'node-test', declaredScript: declared }
      : { family: 'unsupported', declaredScript: declared }
  }
  return { family: 'node-test', declaredScript: null }
}

export function deriveFocusedCommand(testFile, runnerFamily = { family: 'node-test', declaredScript: null }) {
  const relativePath = normalizeRelativePath(testFile)
  if (runnerFamily.family !== 'node-test') {
    return {
      error:
        `the owning package of ${relativePath} declares the test script "${runnerFamily.declaredScript}", which the ` +
        'controller cannot drive as an exact argv; it only drives a `node --test` runner today',
    }
  }
  const runner = FOCUSED_RUNNERS.find((candidate) => candidate.pattern.test(relativePath))
  if (!runner) return { error: `no controller runner is registered for ${relativePath}` }
  const argv = [process.execPath, ...runner.args(relativePath)]
  const offending = argv.find((token) => SHELL_METACHARACTER_PATTERN.test(token))
  if (offending !== undefined) {
    return { error: `the command derived for ${relativePath} carries the shell metacharacter token "${offending}"` }
  }
  return { runner: runner.runner, argv }
}

function isContainedRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false
  return !normalized.split('/').includes('..')
}

function overlayWorkingTreePaths(root, worktree, relativePaths) {
  for (const relativePath of relativePaths) {
    if (!isContainedRelativePath(relativePath)) continue
    const source = path.join(root, relativePath)
    const target = path.join(worktree, relativePath)
    if (isRegularFile(source)) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
    } else if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true, recursive: true })
    }
  }
}

function linkResolutionRoots(root, worktree, relativePath) {
  const segments = normalizeRelativePath(relativePath).split('/').slice(0, -1)
  const directories = ['']
  let accumulated = ''
  for (const segment of segments) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment
    directories.push(accumulated)
  }
  for (const directory of directories) {
    const target = path.join(root, directory, 'node_modules')
    const link = path.join(worktree, directory, 'node_modules')
    if (!fs.existsSync(target) || fs.existsSync(link)) continue
    fs.mkdirSync(path.dirname(link), { recursive: true })
    try { fs.symlinkSync(target, link, 'junction') } catch { /* resolution stays worktree-local */ }
  }
}

// A controller invoked from inside a test runner would otherwise leak its runner context into the
// child, which suppresses the child's own exit status and makes every focused run look like a pass.
export const STRIPPED_EXECUTION_ENV_KEYS = Object.freeze([
  'NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'NODE_V8_COVERAGE', 'TEST_RUNNER_CONCURRENCY',
])

export function sanitizeExecutionEnv(sourceEnv) {
  const env = { ...sourceEnv }
  for (const key of STRIPPED_EXECUTION_ENV_KEYS) delete env[key]
  return env
}

function runControlledCommand(cwd, argv, timeoutMs) {
  const env = sanitizeExecutionEnv(process.env)
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  if (result.error || result.signal || typeof result.status !== 'number') {
    return { failed: true, reason: result.signal ? `terminated by signal ${result.signal}` : String(result.error ?? 'no exit status') }
  }
  return {
    exitCode: result.status,
    stdoutSha256: createHash('sha256').update(result.stdout ?? Buffer.alloc(0)).digest('hex'),
    stderrSha256: createHash('sha256').update(result.stderr ?? Buffer.alloc(0)).digest('hex'),
  }
}

function addWorktree(root, sha, directory) {
  git(root, ['worktree', 'add', '--detach', '--quiet', directory, sha])
}

// Returns true when the clean removal failed and left an administrative entry behind. The caller
// prunes only then: an unconditional prune would also drop sibling worktrees of the same repository
// whose directories happen to be unavailable, which is not this controller's to decide.
function removeWorktree(root, directory) {
  try {
    git(root, ['worktree', 'remove', '--force', directory])
    return false
  } catch {
    fs.rmSync(directory, { recursive: true, force: true })
    return true
  }
}

/**
 * Controller-owned focused execution. For each declared focused test the controller builds two
 * isolated worktrees: the base commit with ONLY that test's own head content applied, and the head
 * commit with the whole working-tree diff applied. It runs the derived argv exactly once per side —
 * there is no retry — and records exit codes plus output hashes as evidence.
 */
export function runFocusedExecutions(input) {
  const root = path.resolve(input.root)
  const baseSha = input.baseSha
  const changedPaths = [...new Set((input.changedPaths ?? []).map(normalizeRelativePath))]
  const timeoutMs = input.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS
  const executions = []
  const errors = []
  const testFiles = [...new Set((input.testFiles ?? []).map(normalizeRelativePath))]
  if (!testFiles.length) return { executions, errors }

  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'om-knowledge-exec-'))
  let removalFellBack = false
  try {
    for (const [index, testFile] of testFiles.entries()) {
      const headAbsolute = path.join(root, testFile)
      if (!isContainedRelativePath(testFile) || !isRegularFile(headAbsolute)) {
        errors.push(`focusedExecutions ${testFile} is not an exact regular file inside the repository, so it cannot be executed`)
        continue
      }
      const derivedCommand = deriveFocusedCommand(testFile, resolveTestRunnerFamily(root, testFile))
      if (derivedCommand.error) { errors.push(`focusedExecutions ${derivedCommand.error}`); continue }

      const headContents = fs.readFileSync(headAbsolute)
      const baseContents = baseFileBuffer(root, baseSha, testFile)
      if (baseContents !== null && baseContents.equals(headContents)) {
        errors.push(
          `focusedExecutions ${testFile} has no test-only diff against the base; a knowledge-contract change must add ` +
          'or repair the regression that proves the new behavior',
        )
        continue
      }

      const baseWorktree = path.join(scratch, `base-${index}`)
      const headWorktree = path.join(scratch, `head-${index}`)
      let baseOutcome
      let headOutcome
      try {
        addWorktree(root, baseSha, baseWorktree)
        overlayWorkingTreePaths(root, baseWorktree, [testFile])
        linkResolutionRoots(root, baseWorktree, testFile)
        baseOutcome = runControlledCommand(baseWorktree, derivedCommand.argv, timeoutMs)

        addWorktree(root, input.headSha, headWorktree)
        overlayWorkingTreePaths(root, headWorktree, changedPaths)
        linkResolutionRoots(root, headWorktree, testFile)
        headOutcome = runControlledCommand(headWorktree, derivedCommand.argv, timeoutMs)
      } catch (error) {
        errors.push(`focusedExecutions ${testFile} could not be executed in an isolated worktree: ${error.message}`)
        continue
      } finally {
        removalFellBack = removeWorktree(root, baseWorktree) || removalFellBack
        removalFellBack = removeWorktree(root, headWorktree) || removalFellBack
      }

      if (baseOutcome.failed || headOutcome.failed) {
        const failing = baseOutcome.failed ? `base-plus-test-only (${baseOutcome.reason})` : `head (${headOutcome.reason})`
        errors.push(`focusedExecutions ${testFile} produced no usable ${failing} exit status`)
        continue
      }
      executions.push({
        testFile,
        command: derivedCommand.argv,
        baseWithTestPatch: baseOutcome,
        head: headOutcome,
      })
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
    if (removalFellBack) { try { git(root, ['worktree', 'prune']) } catch { /* pruning is best effort */ } }
  }
  return { executions, errors }
}

export function assertFocusedExecutionEvidence(declaredTests, evidence) {
  const errors = []
  if (!evidence) {
    return ['the controller produced no focused base/head execution evidence; a knowledge-contract change cannot be certified without it']
  }
  errors.push(...(evidence.errors ?? []))
  const executions = evidence.executions ?? []
  for (const testFile of declaredTests) {
    const execution = executions.find((entry) => entry.testFile === normalizeRelativePath(testFile))
    if (!execution) {
      errors.push(`focusedExecutions has no base/head execution record for declared focused test ${testFile}`)
      continue
    }
    if (execution.baseWithTestPatch.exitCode === 0) {
      errors.push(
        `focusedExecutions ${testFile} exited 0 on base-plus-test-only; the focused test must fail for the old behavior`,
      )
    }
    if (execution.head.exitCode !== 0) {
      errors.push(`focusedExecutions ${testFile} exited ${execution.head.exitCode} at head; the focused test must pass after the change`)
    }
  }
  for (const execution of executions) {
    if (!declaredTests.map(normalizeRelativePath).includes(execution.testFile)) {
      errors.push(`focusedExecutions carries an execution for ${execution.testFile}, which the manifest does not declare`)
    }
  }
  return errors
}

/**
 * Validates one knowledge-change run manifest against the derived classification of
 * its own diff. `changedPaths` is supplied by the caller so the derivation stays
 * testable without a shell; the CLI derives it from git.
 */
export function validateKnowledgeChange(input) {
  const root = path.resolve(input.root)
  const manifest = input.manifest
  const schema = input.schema
  const errors = []
  const derived = {}

  const schemaErrors = validateJsonSchema(manifest, schema.$defs.authoredManifest, '$', schema)
  for (const field of CONTROLLER_OWNED_FIELDS) {
    if (isPlainObject(manifest) && Object.hasOwn(manifest, field)) {
      errors.push(`${field} is controller-owned output; author-supplied evidence fails validation`)
    }
  }
  errors.push(...schemaErrors.map((error) => `manifest schema: ${error}`))
  if (!isPlainObject(manifest)) return { ok: false, errors, derived }

  const classification = deriveChangeClassification(input.changedPaths)
  derived.changeClass = classification.changeClass
  derived.changedContracts = classification.changedContracts
  derived.classifiedPaths = classification.records
  derived.unclassifiedPaths = classification.unclassifiedPaths

  if (manifest.changeClass !== classification.changeClass) {
    errors.push(
      `declared changeClass "${manifest.changeClass}" differs from the class derived from the diff ` +
      `"${classification.changeClass}"`,
    )
  }
  const declaredContracts = Array.isArray(manifest.changedContracts) ? manifest.changedContracts : []
  const missingContracts = classification.changedContracts.filter((contract) => !declaredContracts.includes(contract))
  const extraContracts = declaredContracts.filter((contract) => !classification.changedContracts.includes(contract))
  if (missingContracts.length) errors.push(`changedContracts omits derived contracts: ${missingContracts.join(', ')}`)
  if (extraContracts.length) errors.push(`changedContracts declares contracts the diff does not touch: ${extraContracts.join(', ')}`)

  checkFileRecords(root, 'authoritativeFiles', manifest.authoritativeFiles ?? [], errors)
  checkFileRecords(root, 'generatedFiles', manifest.generatedFiles ?? [], errors, { sourcePathRequired: true })
  for (const documentationPath of manifest.documentationFiles ?? []) {
    if (!isRegularFile(path.join(root, documentationPath))) {
      errors.push(`documentationFiles ${documentationPath} is not an exact regular file in the working tree`)
    }
  }

  // Declared-integration-test check. Applies whenever the diff touches the canonical example or its
  // inventory, independently of change class: a coverage declaration that has rotted is a failure in
  // an asset-sync run exactly as much as in a knowledge-contract one.
  const touchesExample = (input.changedPaths ?? []).some((changedPath) => {
    const normalized = normalizeRelativePath(changedPath)
    return normalized.startsWith(`${EXAMPLE_AUTHORING_ROOT}/`) || normalized.startsWith(`${EXAMPLE_TEMPLATE_ROOT}/`)
  })
  if (touchesExample) {
    const headRows = readExampleCapabilityRows(readJsonIfPresent(path.join(root, EXAMPLE_SURFACE_INVENTORY_PATH)))
    let baseRows = null
    if (input.baseSha) {
      const buffer = baseFileBuffer(root, input.baseSha, EXAMPLE_SURFACE_INVENTORY_PATH)
      if (buffer) {
        try {
          baseRows = readExampleCapabilityRows(JSON.parse(buffer.toString('utf8')))
        } catch {
          baseRows = null
        }
      }
    }
    const coverageErrors = exampleCoverageErrors(headRows, baseRows, {
      pathExists: (relativePath) => isRegularFile(path.join(root, EXAMPLE_APP_ROOT, relativePath)),
    })
    derived.exampleCapabilityCount = headRows?.length ?? 0
    derived.exampleCoverageErrorCount = coverageErrors.length
    errors.push(...coverageErrors)
  }

  if (classification.changeClass === 'asset-sync' || manifest.changeClass === 'asset-sync') {
    for (const record of classification.records) {
      if (record.contract) errors.push(`asset-sync run touches ${record.path}, which carries the ${record.contract} contract`)
    }
  }
  if (classification.changeClass === 'asset-sync') {
    if (input.baseSha) {
      for (const generated of manifest.generatedFiles ?? []) {
        const baseHash = baseFileHash(root, input.baseSha, generated.sourcePath)
        const headAbsolute = path.join(root, generated.sourcePath)
        const headHash = isRegularFile(headAbsolute) ? hashFile(headAbsolute) : null
        if (baseHash !== null && headHash !== null && baseHash !== headHash) {
          errors.push(
            `asset-sync run changed authoritative source ${generated.sourcePath}; ` +
            'a semantic source change is a knowledge-contract change',
          )
        }
      }
    }
  }

  if (classification.changeClass === 'knowledge-contract') {
    const declaredTests = Array.isArray(manifest.focusedTestFiles) ? manifest.focusedTestFiles.map(normalizeRelativePath) : []
    const changedTests = declaredTests.filter((testPath) => classification.focusedTestPaths.includes(testPath))
    if (!declaredTests.length) {
      errors.push('a knowledge-contract change requires at least one focused test that demonstrates the affected contract')
    }
    for (const testPath of declaredTests) {
      if (!isFocusedTestPath(testPath)) errors.push(`focusedTestFiles ${testPath} is not a test file`)
      if (!isRegularFile(path.join(root, testPath))) errors.push(`focusedTestFiles ${testPath} is not an exact regular file in the working tree`)
    }
    if (declaredTests.length && !changedTests.length) {
      errors.push('no declared focused test appears in the diff; a knowledge-contract change must add or repair its own regression')
    }

    const cases = input.cases ?? readJsonIfPresent(path.join(root, input.harnessRelativeDir ?? '', 'cases.json'))
    if (!Array.isArray(cases)) {
      errors.push('the case catalog could not be read, so affected cases and the catalog count cannot be verified')
    } else {
      const knownCaseIds = new Set(cases.map((entry) => entry?.id))
      for (const caseId of manifest.affectedCaseIds ?? []) {
        if (!knownCaseIds.has(caseId)) errors.push(`affectedCaseIds ${caseId} does not exist in the case catalog`)
      }
      if (manifest.expectedCatalogCount !== cases.length) {
        errors.push(`expectedCatalogCount ${manifest.expectedCatalogCount} does not match the catalog's ${cases.length} cases`)
      }
      for (const rangeId of manifest.affectedRanges ?? []) {
        const expanded = expandCaseRange(rangeId)
        if (!expanded) { errors.push(`affectedRanges ${rangeId} is not an ascending OMH range`); continue }
        const missing = expanded.filter((caseId) => !knownCaseIds.has(caseId))
        if (missing.length) errors.push(`affectedRanges ${rangeId} covers cases absent from the catalog: ${missing.join(', ')}`)
      }
      const rangeMembers = new Set((manifest.affectedRanges ?? []).flatMap((rangeId) => expandCaseRange(rangeId) ?? []))
      for (const caseId of manifest.affectedCaseIds ?? []) {
        if (rangeMembers.size && !rangeMembers.has(caseId)) {
          errors.push(`affectedCaseIds ${caseId} falls outside every declared affected range`)
        }
      }
    }

    const releaseMatrix = input.releaseMatrix ?? readJsonIfPresent(path.join(root, input.harnessRelativeDir ?? '', 'release-matrix.json'))
    if (!isPlainObject(releaseMatrix)) {
      errors.push('the release matrix could not be read, so required lanes cannot be verified')
    } else {
      for (const lane of manifest.requiredReleaseLanes ?? []) {
        if (!Object.hasOwn(releaseMatrix, lane)) errors.push(`requiredReleaseLanes ${lane} is not a lane in the release matrix`)
      }
      if (!(manifest.requiredReleaseLanes ?? []).length) {
        errors.push('a knowledge-contract change must name at least one affected certified release lane')
      }
    }

    const executionErrors = assertFocusedExecutionEvidence(declaredTests, input.executionEvidence)
    derived.focusedExecutions = input.executionEvidence?.executions ?? []
    errors.push(...executionErrors)
  }

  const linkedContracts = ['source-link', 'example-source', 'installed-source']
  const needsSourceLinkInventory = classification.changedContracts.some((contract) => linkedContracts.includes(contract))
  derived.sourceLinkInventoryRequired = needsSourceLinkInventory
  if (needsSourceLinkInventory) {
    checkSourceLinkInventory(root, isPlainObject(manifest.sourceLinkInventory) ? manifest.sourceLinkInventory : {}, errors, derived)
  }

  checkExampleSourceMirrors(root, classification.records, errors, derived)

  return { ok: errors.length === 0, errors, derived }
}

function writeJsonAtomic(absolutePath, value) {
  const directory = path.dirname(absolutePath)
  fs.mkdirSync(directory, { recursive: true })
  const temporaryPath = path.join(directory, `.${path.basename(absolutePath)}.${process.pid}.tmp`)
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temporaryPath, absolutePath)
}

function usage() {
  return [
    'Usage: validate-knowledge-change --manifest <path> --base <ref> [--root <dir>] [--harness-dir <dir>]',
    '                                 [--out <path>] [--execution-timeout <ms>]',
    '',
    'Derives the knowledge-contract/asset-sync class from the diff between <ref> and the working tree,',
    'validates the authored run manifest against knowledge-change.schema.json, and — for a knowledge-contract',
    'change — runs each declared focused test once in an isolated base-plus-test-only worktree and once at head,',
    'recording exit codes and output hashes as controller-owned evidence. The result is written atomically.',
  ].join('\n')
}

function parseArgs(argv) {
  const options = { root: process.cwd(), help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') { options.help = true; continue }
    const value = argv[index + 1]
    if (token === '--manifest') { options.manifest = value; index += 1; continue }
    if (token === '--base') { options.base = value; index += 1; continue }
    if (token === '--root') { options.root = value; index += 1; continue }
    if (token === '--harness-dir') { options.harnessDir = value; index += 1; continue }
    if (token === '--out') { options.out = value; index += 1; continue }
    if (token === '--execution-timeout') {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--execution-timeout must be a positive integer of milliseconds')
      options.executionTimeoutMs = parsed
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${token}`)
  }
  return options
}

function defaultHarnessRelativeDir(root) {
  const candidates = ['packages/create-app/agentic/shared/ai/harness', 'agentic/shared/ai/harness', '.ai/harness']
  return candidates.find((candidate) => isRegularFile(path.join(root, candidate, 'cases.json'))) ?? '.ai/harness'
}

export function main(argv = process.argv.slice(2)) {
  let options
  try { options = parseArgs(argv) } catch (error) { console.error(error.message); console.error(usage()); return EXIT_INVALID }
  if (options.help) { console.log(usage()); return EXIT_PASS }
  if (!options.manifest || !options.base) { console.error('--manifest and --base are required'); console.error(usage()); return EXIT_INVALID }

  const root = path.resolve(options.root)
  const harnessRelativeDir = options.harnessDir ?? defaultHarnessRelativeDir(root)
  const schemaCandidates = [
    path.join(root, harnessRelativeDir, SCHEMA_BASENAME),
    fileURLToPath(new URL(`../ai/harness/${SCHEMA_BASENAME}`, import.meta.url)),
    fileURLToPath(new URL(`../.ai/harness/${SCHEMA_BASENAME}`, import.meta.url)),
  ]
  const schemaPath = schemaCandidates.find((candidate) => isRegularFile(candidate))
  if (!schemaPath) { console.error(`knowledge-change schema not found: ${schemaCandidates.join(', ')}`); return EXIT_INVALID }
  const schema = readJsonIfPresent(schemaPath)
  if (!schema) { console.error(`knowledge-change schema is not valid JSON: ${schemaPath}`); return EXIT_INVALID }

  const manifestPath = path.resolve(root, options.manifest)
  const manifest = readJsonIfPresent(manifestPath)
  if (manifest === null) { console.error(`run manifest not found or not valid JSON: ${manifestPath}`); return EXIT_INVALID }

  let baseSha
  let headSha
  let changedPaths
  try {
    baseSha = resolveGitSha(root, options.base)
    headSha = resolveGitSha(root, 'HEAD')
    changedPaths = deriveChangedPaths(root, baseSha)
  } catch (error) { console.error(error.message); return EXIT_INVALID }

  let baseRefError = null
  if (manifest.baseRef !== options.base && manifest.baseRef !== baseSha) {
    let authoredSha = null
    try { authoredSha = resolveGitSha(root, manifest.baseRef) } catch { authoredSha = null }
    if (authoredSha !== baseSha) {
      baseRefError = `authored baseRef "${manifest.baseRef}" does not resolve to the --base SHA ${baseSha}`
    }
  }

  const classification = deriveChangeClassification(changedPaths)
  let executionEvidence = null
  if (classification.changeClass === 'knowledge-contract') {
    executionEvidence = baseRefError
      ? { executions: [], errors: ['focused base/head execution was not attempted because the authored baseRef does not resolve to --base'] }
      : runFocusedExecutions({
        root,
        baseSha,
        headSha,
        changedPaths,
        testFiles: Array.isArray(manifest.focusedTestFiles) ? manifest.focusedTestFiles : [],
        timeoutMs: options.executionTimeoutMs,
      })
  }

  const result = validateKnowledgeChange({
    root, manifest, schema, changedPaths, baseSha, harnessRelativeDir, executionEvidence,
  })
  if (baseRefError) { result.errors.unshift(baseRefError); result.ok = false }

  const completed = {
    ...manifest,
    resolvedBaseSha: baseSha,
    headSha,
    focusedExecutions: executionEvidence?.executions ?? [],
  }
  const completedErrors = validateJsonSchema(completed, schema.$defs.completedManifest, '$', schema)
  if (completedErrors.length) {
    result.errors.push(...completedErrors.map((error) => `completed manifest schema: ${error}`))
    result.ok = false
  }
  const outputPath = path.resolve(root, options.out ?? `${options.manifest}.result.json`)
  writeJsonAtomic(outputPath, {
    status: result.ok ? 'pass' : 'fail',
    manifest: completed,
    derived: result.derived,
    changedPaths,
    errors: result.errors,
  })

  for (const error of result.errors) console.error(`knowledge-change: ${error}`)
  console.log(`${result.ok ? 'PASS' : 'FAIL'} knowledge-change ${result.derived.changeClass} — ${outputPath}`)
  return result.ok ? EXIT_PASS : EXIT_FAILURE
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = main()
