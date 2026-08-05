#!/usr/bin/env node

/**
 * Generate the CANON-C source-link inventory.
 *
 * The inventory is a *derived* asset: every record is computed from the emitted knowledge
 * owners, the canonical example surface inventory, the harness case catalog, and the checked
 * `main` fence-disposition baseline. It must never be hand-edited.
 *
 * Maintainer decision D4 makes `source-link-topics.json` a contract rather than a second
 * authority: the generator re-derives the whole `source-required` topic set from the owner
 * scan and refuses to emit anything unless that derived set equals the registry's exactly, in
 * both directions. The 25 `retained-normative-snippet` rule topics are not derivable from
 * links — they name prose an owner must still carry — so they are carried from the registry
 * and each one's literal `evidence` is re-checked against its owner on every run.
 *
 * Usage:
 *   node scripts/generate-source-link-inventory.mjs            # write the inventory
 *   node scripts/generate-source-link-inventory.mjs --check    # regenerate and diff (no write)
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  authoringPathOfEmittedPath,
  deriveTopicId,
  emittedMarkdownOwners,
  relativeMarkdownLinkHrefs,
  HARNESS_RELATIVE_DIR,
} from './validate-source-links.mjs'

const EXIT_PASS = 0
const EXIT_FAILURE = 1
const EXIT_INVALID = 2

export const INVENTORY_RELATIVE_PATH = `${HARNESS_RELATIVE_DIR}/source-link-inventory.json`
export const BASELINE_RELATIVE_PATH = `${HARNESS_RELATIVE_DIR}/source-link-baseline.json`
export const TOPICS_RELATIVE_PATH = `${HARNESS_RELATIVE_DIR}/source-link-topics.json`

/**
 * App-facing projection of the same derivation.
 *
 * The full inventory above stays repository-only: it carries monorepo authoring paths, harness
 * case IDs and repository-only QA evidence, none of which mean anything inside a scaffolded app.
 * The projection is what a scaffolded app receives as `.ai/harness/source-link-inventory.json`,
 * and it is what `context.sourceReferenceIds` resolves against. Both files are written by the
 * same generator run from the same records, so the two can never drift apart.
 */
export const PROJECTION_RELATIVE_PATH =
  'packages/create-app/agentic/shared/ai/harness/source-link-inventory.json'

/** Record fields the app-facing projection carries. Everything else is repository-only. */
export const PROJECTED_RECORD_FIELDS = Object.freeze([
  'referenceId',
  'requirement',
  'originAsset',
  'heading',
  'href',
  'targetKind',
  'readStatus',
  'resolvedPath',
  'moduleId',
  'capabilityIds',
])

export const SURFACE_INVENTORY_RELATIVE_PATH =
  'packages/create-app/template/src/modules/example/references/surface-inventory.json'
export const CASES_RELATIVE_PATH = 'packages/create-app/agentic/shared/ai/harness/cases.json'

export const INVENTORY_VERSION = 1

const EXAMPLE_ROOT = 'src/modules/example/'
const INSTALLED_ROOT = 'node_modules/'
const QA_ONLY_SEGMENTS = new Set(['__tests__', '__integration__'])

const GENERATED_NOTE =
  'Derived asset — regenerate with `yarn workspace create-mercato-app harness:generate-source-link-inventory`. '
  + 'Never hand-edit; `source-link-inventory.test.ts` fails on any drift between this file and a fresh derivation.'

/** Nearest preceding ATX heading for the first rendered occurrence of `](href)` in `source`. */
export function headingForRenderedLink(source, href) {
  const needle = `](${href})`
  const index = source.indexOf(needle)
  if (index === -1) return null
  let heading = null
  let cursor = 0
  for (const line of source.split(/\r?\n/)) {
    const lineStart = cursor
    cursor += line.length + 1
    if (lineStart > index) break
    const atx = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (atx) heading = atx[2]
  }
  return heading
}

/** How many times `owner` literally renders a Markdown link to `href`. */
export function renderedLinkCount(source, href) {
  return relativeMarkdownLinkHrefs(source).filter((candidate) => candidate === href).length
}

export function targetKindOf(resolvedPath) {
  if (resolvedPath.startsWith(INSTALLED_ROOT)) return 'installed-package'
  if (resolvedPath.startsWith(EXAMPLE_ROOT)) return 'canonical-example'
  return 'local-owner'
}

export function readStatusOf(resolvedPath) {
  return resolvedPath.split('/').some((segment) => QA_ONLY_SEGMENTS.has(segment)) ? 'qa-only' : 'readable'
}

export function moduleIdOf(resolvedPath) {
  const match = /^src\/modules\/([^/]+)\//.exec(resolvedPath)
  return match ? match[1] : null
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

/**
 * Re-derive every `source-required` topic from the emitted owner scan.
 *
 * This is the half of the topic set that is genuinely derivable: one topic per
 * (emitted owner, resolved link target) pair, keyed by the same ID the validator derives.
 */
export function deriveRenderedTopics({ packageRoot }) {
  const derived = new Map()
  const ownerSources = new Map()
  for (const owner of emittedMarkdownOwners(packageRoot)) {
    const authoring = authoringPathOfEmittedPath(owner)
    if (authoring === null) continue
    let source
    try {
      source = fs.readFileSync(path.join(packageRoot, authoring), 'utf8')
    } catch {
      continue
    }
    ownerSources.set(owner, source)
    for (const href of relativeMarkdownLinkHrefs(source)) {
      const resolvedPath = path.posix.normalize(
        path.posix.join(path.posix.dirname(owner), decodeURIComponent(href.split('#')[0])),
      )
      const topicId = deriveTopicId(owner, resolvedPath)
      if (topicId === null) continue
      if (derived.has(topicId)) continue
      derived.set(topicId, { topicId, owner, href, resolvedPath })
    }
  }
  return { derived, ownerSources }
}

function capabilityIndex(surfaceInventory) {
  const bySourcePath = new Map()
  for (const capability of surfaceInventory?.capabilities ?? []) {
    for (const sourcePath of capability.sourcePaths ?? []) {
      const bucket = bySourcePath.get(sourcePath) ?? []
      bucket.push(capability)
      bySourcePath.set(sourcePath, bucket)
    }
  }
  return bySourcePath
}

function caseIndex(cases) {
  const byOwnerPath = new Map()
  for (const entry of Array.isArray(cases) ? cases : []) {
    const paths = new Set()
    if (typeof entry.owner?.path === 'string') paths.add(entry.owner.path)
    for (const required of entry.context?.required ?? []) {
      if (typeof required === 'string') paths.add(required)
    }
    for (const ownerPath of paths) {
      const bucket = byOwnerPath.get(ownerPath) ?? []
      bucket.push(entry.id)
      byOwnerPath.set(ownerPath, bucket)
    }
  }
  return byOwnerPath
}

function baselineIndex(baseline) {
  const replaces = new Map()
  const cited = new Map()
  for (const block of baseline?.blocks ?? []) {
    for (const topicId of block.targetTopicIds ?? []) {
      const bucket = replaces.get(topicId) ?? []
      bucket.push(block.id)
      replaces.set(topicId, bucket)
    }
    for (const topicId of block.topicIds ?? []) {
      const bucket = cited.get(topicId) ?? []
      bucket.push(block.id)
      cited.set(topicId, bucket)
    }
  }
  return { replaces, cited }
}

/**
 * Build the inventory, or explain exactly why it cannot be built.
 *
 * Returns `{ errors, inventory }`; `inventory` is null whenever `errors` is non-empty, so a
 * drifted registry can never produce a silently regenerated manifest.
 */
export function buildInventory({ packageRoot, registry, baseline, surfaceInventory, cases }) {
  const errors = []
  const registryTopics = Array.isArray(registry?.topics) ? registry.topics : null
  if (registryTopics === null || registryTopics.length === 0) {
    return { errors: ['topic registry must declare a non-empty "topics" array'], inventory: null }
  }

  const { derived, ownerSources } = deriveRenderedTopics({ packageRoot })
  const registryById = new Map()
  for (const topic of registryTopics) {
    if (typeof topic?.topicId !== 'string' || topic.topicId.length === 0) {
      errors.push('every registry topic must declare a non-empty topicId')
      continue
    }
    if (registryById.has(topic.topicId)) errors.push(`duplicate registry topicId "${topic.topicId}"`)
    registryById.set(topic.topicId, topic)
  }

  const registrySourceRequired = new Set(
    [...registryById.values()].filter((topic) => topic.requirement === 'source-required').map((topic) => topic.topicId),
  )
  for (const topicId of [...derived.keys()].sort()) {
    if (!registrySourceRequired.has(topicId)) {
      errors.push(`derived topic "${topicId}" is rendered by an emitted owner but absent from the checked registry`)
    }
  }
  for (const topicId of [...registrySourceRequired].sort()) {
    if (!derived.has(topicId)) {
      errors.push(`registry topic "${topicId}" is declared source-required but no emitted owner renders it`)
    }
  }

  for (const topicId of [...registrySourceRequired].sort()) {
    const registryTopic = registryById.get(topicId)
    const derivedTopic = derived.get(topicId)
    if (!derivedTopic) continue
    if (registryTopic.owner !== derivedTopic.owner) {
      errors.push(`topic "${topicId}" declares owner "${registryTopic.owner}", derived "${derivedTopic.owner}"`)
    }
    if (registryTopic.href !== derivedTopic.href) {
      errors.push(`topic "${topicId}" declares href "${String(registryTopic.href)}", derived "${derivedTopic.href}"`)
    }
    if (registryTopic.resolvedPath !== derivedTopic.resolvedPath) {
      errors.push(
        `topic "${topicId}" declares resolvedPath "${String(registryTopic.resolvedPath)}", derived "${derivedTopic.resolvedPath}"`,
      )
    }
  }

  for (const topic of registryById.values()) {
    if (topic.requirement === 'source-required') continue
    const source = ownerSources.get(topic.owner)
    if (source === undefined) {
      errors.push(`topic "${topic.topicId}" names owner "${String(topic.owner)}", which is not an emitted Markdown owner`)
      continue
    }
    if (typeof topic.evidence !== 'string' || topic.evidence.length === 0) {
      errors.push(`topic "${topic.topicId}" is ${String(topic.requirement)} and must declare its literal evidence`)
      continue
    }
    if (!source.includes(topic.evidence)) {
      errors.push(`topic "${topic.topicId}" declares evidence its owner "${topic.owner}" no longer contains`)
    }
  }

  if (errors.length) return { errors, inventory: null }

  const capabilities = capabilityIndex(surfaceInventory)
  const casesByPath = caseIndex(cases)
  const { replaces, cited } = baselineIndex(baseline)

  const records = []
  for (const topicId of [...registryById.keys()].sort()) {
    const topic = registryById.get(topicId)
    const source = ownerSources.get(topic.owner)
    const isSourceRequired = topic.requirement === 'source-required'
    const resolvedPath = isSourceRequired ? topic.resolvedPath : topic.owner
    const matchedCapabilities = capabilities.get(resolvedPath) ?? []

    const record = {
      topicId,
      // A source-reference ID and a topic ID identify the same thing — one visible link in one
      // emitted owner resolving to one exact target. They are deliberately the SAME string
      // rather than two derivations of it: a second identifier space would be free to drift
      // from the first, and `source-link-inventory.test.ts` pins the equality so a later change
      // cannot fork them silently.
      referenceId: topicId,
      requirement: topic.requirement,
      originAsset: topic.owner,
      originAuthoringPath: authoringPathOfEmittedPath(topic.owner),
      heading: isSourceRequired ? headingForRenderedLink(source, topic.href) : null,
      targetKind: isSourceRequired ? targetKindOf(resolvedPath) : 'local-owner',
      readStatus: readStatusOf(resolvedPath),
      resolvedPath,
      targetAuthoringPath: authoringPathOfEmittedPath(resolvedPath),
      moduleId: moduleIdOf(resolvedPath),
      capabilityIds: sortedUnique(matchedCapabilities.map((capability) => capability.capabilityId)),
      integrationTestPaths: sortedUnique(
        matchedCapabilities.flatMap((capability) => capability.integrationTestPaths ?? []),
      ),
      affectedCaseIds: sortedUnique([
        ...(casesByPath.get(topic.owner) ?? []),
        ...(casesByPath.get(resolvedPath) ?? []),
      ]),
      replacesBaselineBlockIds: sortedUnique(replaces.get(topicId) ?? []),
      citedByBaselineBlockIds: sortedUnique(cited.get(topicId) ?? []),
    }
    if (isSourceRequired) {
      record.href = topic.href
      record.renderedLinkCount = renderedLinkCount(source, topic.href)
    } else {
      record.evidence = topic.evidence
    }
    records.push(record)
  }

  const inventory = {
    version: INVENTORY_VERSION,
    generatedNote: GENERATED_NOTE,
    inputs: {
      topics: TOPICS_RELATIVE_PATH,
      baseline: BASELINE_RELATIVE_PATH,
      surfaceInventory: SURFACE_INVENTORY_RELATIVE_PATH,
      cases: CASES_RELATIVE_PATH,
    },
    derived: {
      ownerCount: sortedUnique(records.map((record) => record.originAsset)).length,
      recordCount: records.length,
      sourceRequiredCount: records.filter((record) => record.requirement === 'source-required').length,
      renderedLinkCount: records.reduce((total, record) => total + (record.renderedLinkCount ?? 0), 0),
      baselineSha: typeof baseline?.baselineSha === 'string' ? baseline.baselineSha : null,
    },
    notCovered: [
      'installed-package targets: no emitted owner renders one yet, so no record carries an installed version or content hash.',
      'design-system gallery and Code Connect envelopes: PR #4301 / #4277 assets are not packed in this repository.',
      'preset and tier applicability: every emitted owner ships in every preset, so no record narrows it.',
    ],
    records,
  }
  return { errors: [], inventory }
}

const PROJECTION_NOTE =
  'Derived asset — the app-facing projection of the repository source-link inventory, regenerated with '
  + '`yarn workspace create-mercato-app harness:generate-source-link-inventory`. Never hand-edit. '
  + 'Harness cases resolve `context.sourceReferenceIds` against `referenceId` here; a record with '
  + '`readStatus: "qa-only"` is validation evidence only and is refused as a case reference.'

/**
 * Project the repository inventory down to what a scaffolded app may see.
 *
 * Repository-only fields are dropped rather than blanked, so a consumer cannot mistake an empty
 * authoring path or case list for a real one.
 */
export function projectInventory(inventory) {
  const records = inventory.records.map((record) => {
    const projected = {}
    for (const field of PROJECTED_RECORD_FIELDS) {
      if (record[field] !== undefined) projected[field] = record[field]
    }
    return projected
  })
  return {
    version: inventory.version,
    generatedNote: PROJECTION_NOTE,
    derived: {
      ownerCount: inventory.derived.ownerCount,
      recordCount: records.length,
      sourceRequiredCount: inventory.derived.sourceRequiredCount,
      readableCount: records.filter((record) => record.readStatus === 'readable').length,
      baselineSha: inventory.derived.baselineSha,
    },
    notCovered: inventory.notCovered,
    records,
  }
}

export function serializeInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`
}

function readJson(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
}

export function loadInputs(root) {
  const packageRoot = path.join(root, 'packages', 'create-app')
  return {
    packageRoot,
    registry: readJson(path.join(root, TOPICS_RELATIVE_PATH)),
    baseline: readJson(path.join(root, BASELINE_RELATIVE_PATH)),
    surfaceInventory: readJson(path.join(root, SURFACE_INVENTORY_RELATIVE_PATH)),
    cases: readJson(path.join(root, CASES_RELATIVE_PATH)),
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function repoRoot(startDir) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: startDir, encoding: 'utf8' }).trim()
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check')
  let root
  try {
    root = argv.includes('--root')
      ? path.resolve(argv[argv.indexOf('--root') + 1])
      : repoRoot(fileURLToPath(new URL('.', import.meta.url)))
  } catch (error) {
    console.error(`source-link-inventory: cannot resolve repository root: ${error.message}`)
    return EXIT_INVALID
  }

  let inputs
  try {
    inputs = loadInputs(root)
  } catch (error) {
    console.error(`source-link-inventory: cannot load inputs: ${error.message}`)
    return EXIT_INVALID
  }

  const { errors, inventory } = buildInventory(inputs)
  for (const error of errors) console.error(`source-link-inventory: ${error}`)
  if (inventory === null) {
    console.log('FAIL source-link-inventory')
    return EXIT_FAILURE
  }

  // Both artifacts come from this one derivation, so a stale projection is as loud as a stale
  // inventory and neither can be refreshed without the other.
  const outputs = [
    [INVENTORY_RELATIVE_PATH, serializeInventory(inventory)],
    [PROJECTION_RELATIVE_PATH, serializeInventory(projectInventory(inventory))],
  ]
  for (const [relative, serialized] of outputs) {
    const absolute = path.join(root, relative)
    if (check) {
      let existing
      try {
        existing = fs.readFileSync(absolute, 'utf8')
      } catch {
        console.error(`source-link-inventory: ${relative} is missing; regenerate it`)
        console.log('FAIL source-link-inventory')
        return EXIT_FAILURE
      }
      if (existing !== serialized) {
        console.error(
          `source-link-inventory: ${relative} is stale — checked ${sha256(existing)}, derived ${sha256(serialized)}`,
        )
        console.log('FAIL source-link-inventory')
        return EXIT_FAILURE
      }
    } else {
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, serialized)
    }
  }

  console.log(
    `PASS source-link-inventory — ${inventory.derived.recordCount} records `
    + `(${inventory.derived.sourceRequiredCount} source-required) across ${inventory.derived.ownerCount} owners, `
    + `${inventory.derived.renderedLinkCount} rendered links`,
  )
  return EXIT_PASS
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main()
}
