#!/usr/bin/env node

/**
 * Generate the design-system reference inventory (CANON milestone slices F and G).
 *
 * Two facets of one derived asset:
 *
 * - **F, PR #4301** — every entry in the packed gallery registry, with its exact packed entry
 *   source, the exact packed implementation its public import resolves to, its after-opt-in
 *   route, and its per-preset availability.
 * - **G, PR #4891** — the `designFoundation` sidecar each of those items carries: token
 *   applicability, snapshot availability, Code Connect mapping/artifact/export status, derived
 *   mapping coverage, the two independent node authorities and their comparison, publication
 *   status, and design-skill availability.
 *
 * Everything is derived. Family counts, entry counts, mapping counts and coverage sets are
 * computed from the real registry, the real `figma.connect` calls and the real `npm pack` file
 * lists — never copied from the spec's prose. The one thing that cannot be derived from this
 * repository is external Figma publication, so `publicationStatus` is closed at
 * `not-evidenced` and adding a published state needs a spec amendment.
 *
 * Usage:
 *   node scripts/generate-design-system-inventory.mjs           # write the inventory
 *   node scripts/generate-design-system-inventory.mjs --check   # regenerate and diff (no write)
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import {
  CODE_CONNECT_PACKAGE,
  CODE_CONNECT_WORKSPACE_DIR,
  GALLERY_DIR,
  GALLERY_PACKAGE,
  GALLERY_WORKSPACE_DIR,
  installedPathOf,
  isPacked,
  normalizeFigmaNodeId,
  readCodeConnectMappings,
  readGallery,
  resolvePackageExport,
} from './design-system-sources.mjs'

const EXIT_PASS = 0
const EXIT_FAILURE = 1
const EXIT_INVALID = 2

export const INVENTORY_RELATIVE_PATH = 'packages/create-app/scripts/design-system/design-system-inventory.json'
export const PROJECTION_RELATIVE_PATH =
  'packages/create-app/agentic/shared/ai/harness/design-system-inventory.json'

/** The gallery implementation chain. */
export const GALLERY_PR_URL = 'https://github.com/open-mercato/open-mercato/pull/4301'

/**
 * The design-foundation sidecar's provenance.
 *
 * PR #4277 is the audited work, but it was **closed and merged nothing** — its content landed as
 * PR #4891 at `b2d26489c…`, which is what this repository actually contains. The audited head is
 * kept as provenance only and is deliberately NOT asserted to exist here: it does not. A record
 * that pinned "#4277 merged" would be asserting something false.
 */
export const FOUNDATION_PR_URL = 'https://github.com/open-mercato/open-mercato/pull/4277'
export const FOUNDATION_LANDED_PR_URL = 'https://github.com/open-mercato/open-mercato/pull/4891'
export const FOUNDATION_AUDITED_HEAD_SHA = 'fb9b8ddfe4470ef11d312caa4628c46af7d48adf'
export const FOUNDATION_BASELINE_SHA = 'b2d26489c683edc44265212ac8a79be1b981774f'

/** The skill whose availability decides `designSkillAvailability`. */
export const DESIGN_SKILL_ID = 'om-figma-design-with-ds'
export const DESIGN_TIER_ID = 'design'

export const GALLERY_FEATURE_ID = 'design_system.view'
export const GALLERY_MODULE_ID = 'design_system'
export const GALLERY_ROUTE_BASE = '/backend/design-system'

/** The app-local stylesheet that stays the token truth for a scaffolded app. */
export const LOCAL_TOKEN_SOURCE = 'src/app/globals.css'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function repositoryRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

function isAncestor(root, sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function readJson(absolute) {
  return JSON.parse(fs.readFileSync(absolute, 'utf8'))
}

/**
 * The starter presets a fresh app can be scaffolded with, and whether each registers the gallery.
 *
 * Read from the preset definitions rather than assumed: "every fresh preset is source-only" is a
 * claim about code, and the moment a preset registers `design_system` this asset must say `live`
 * for it instead of repeating the old sentence.
 */
function readPresetAvailability(root) {
  const source = fs.readFileSync(path.join(root, 'packages/create-app/src/lib/starter-presets.ts'), 'utf8')
  const presetIds = [...source.matchAll(/^ {4}id: '([a-z-]+)',$/gm)].map((match) => match[1])
  if (presetIds.length === 0) throw new Error('no starter presets could be read from starter-presets.ts')

  // A preset that never names the module cannot register it. The template baseline is the other
  // half of the same question, so both are read before any preset is called source-only.
  const templateModules = fs.readFileSync(
    path.join(root, 'packages/create-app/template/src/modules.ts'),
    'utf8',
  )
  const registeredInTemplate = new RegExp(`id: '${GALLERY_MODULE_ID}'`).test(templateModules)
  const registeredInPresets = new RegExp(`'${GALLERY_MODULE_ID}'`).test(source)

  const availability = {}
  for (const presetId of presetIds.sort()) {
    availability[presetId] = registeredInTemplate || registeredInPresets ? 'live' : 'source-only'
  }
  return availability
}

/**
 * Whether the audited design skill is emitted to standalone apps.
 *
 * `emitted-opt-in` requires a portable copy the scaffolder actually emits AND a local `design`
 * tier that can select it. Both are checked; the monorepo's own tier manifest is irrelevant to a
 * scaffolded app and is deliberately not consulted as evidence of availability.
 */
function readDesignSkillAvailability(root) {
  const manifestPath = path.join(root, 'packages/create-app/agentic/shared/ai/skills/tiers.json')
  let manifest = null
  try {
    manifest = readJson(manifestPath)
  } catch {
    return { availability: 'unavailable', reason: 'the standalone tier manifest is unreadable' }
  }
  const serialized = JSON.stringify(manifest)
  const declaresTier = new RegExp(`"${DESIGN_TIER_ID}"`).test(serialized)
  const declaresSkill = serialized.includes(DESIGN_SKILL_ID)
  const emittedCopy = fs.existsSync(
    path.join(root, 'packages/create-app/agentic/shared/ai/skills', DESIGN_SKILL_ID),
  )
  if (declaresTier && declaresSkill && emittedCopy) {
    return { availability: 'emitted-opt-in', reason: null }
  }
  const missing = []
  if (!declaresTier) missing.push(`no "${DESIGN_TIER_ID}" tier`)
  if (!declaresSkill) missing.push(`${DESIGN_SKILL_ID} is not selected`)
  if (!emittedCopy) missing.push('no portable copy is emitted')
  return {
    availability: 'unavailable',
    reason: `the standalone skill manifest declares ${missing.join(', ')}`,
  }
}

/** The packed, installed location of a gallery entry's own source file. */
function galleryEntrySource(root, entry) {
  const packageRelativePath = entry.entrySourceRelativePath
  const packed = isPacked(root, GALLERY_WORKSPACE_DIR, packageRelativePath)
  return {
    installedPath: installedPathOf(GALLERY_PACKAGE, packageRelativePath),
    packageRelativePath,
    packed,
  }
}

/**
 * The exact implementation a gallery entry's public import resolves to.
 *
 * Three honest outcomes, and the classification matters downstream: an `@open-mercato` package
 * import resolves to a packed installed file; the token entries point at an app-local stylesheet
 * that every app owns itself; and a third-party import belongs to no Open Mercato package at all.
 * Only the first can carry an installed-source reference.
 */
function resolveImplementation(root, entry) {
  if (entry.importPath === LOCAL_TOKEN_SOURCE || entry.importPath.endsWith('.css')) {
    return {
      kind: 'app-local-token',
      installedPath: null,
      packageName: null,
      packageRelativePath: null,
      packed: null,
      localTokenSource: LOCAL_TOKEN_SOURCE,
    }
  }
  for (const [packageName, workspaceDir] of [
    [CODE_CONNECT_PACKAGE, CODE_CONNECT_WORKSPACE_DIR],
    [GALLERY_PACKAGE, GALLERY_WORKSPACE_DIR],
  ]) {
    const packageRelativePath = resolvePackageExport(root, workspaceDir, packageName, entry.importPath)
    if (packageRelativePath === null) continue
    return {
      kind: 'installed-package',
      installedPath: installedPathOf(packageName, packageRelativePath),
      packageName,
      packageRelativePath,
      packed: isPacked(root, workspaceDir, packageRelativePath),
      localTokenSource: null,
    }
  }
  return {
    kind: 'external-package',
    installedPath: null,
    packageName: null,
    packageRelativePath: null,
    packed: null,
    localTokenSource: null,
  }
}

/**
 * The closed PR #4891 applicability record for one gallery item.
 *
 * Every cross-facet tuple the spec closes is enforced by `foundationTupleErrors` below; this
 * function only decides values from evidence. The two node authorities stay independent: a
 * gallery node never promotes an unmapped Code Connect record, and a Code Connect node never
 * fabricates gallery metadata.
 */
function buildDesignFoundation({ entry, implementation, mappings, packageVersions, codeConnect, designSkill }) {
  const applicable = implementation.kind === 'installed-package'
  const joined = applicable
    ? mappings.filter((mapping) => mapping.publicImportPaths.includes(entry.importPath))
    : []

  const galleryNodeId = normalizeFigmaNodeId(entry.figmaNodeId)
  const galleryNodeStatus = galleryNodeId === null ? 'absent' : 'known'

  const tokenApplicability = implementation.kind === 'app-local-token' ? 'local-css' : 'not-applicable'

  // No snapshot generator ships in this repository, so the only honest value is `unavailable`.
  // Emitting one would require parity proof against the app-local stylesheet, which is a
  // separate deliverable rather than something this asset may assume.
  const snapshotAvailability = 'unavailable'

  if (joined.length === 0) {
    const codeConnectStatus = applicable ? 'unmapped' : 'not-applicable'
    return {
      prUrl: FOUNDATION_PR_URL,
      landedPrUrl: FOUNDATION_LANDED_PR_URL,
      auditedHeadSha: FOUNDATION_AUDITED_HEAD_SHA,
      baselineSha: FOUNDATION_BASELINE_SHA,
      packageName: implementation.packageName,
      packageVersion: implementation.packageName === null
        ? null
        : packageVersions[implementation.packageName] ?? null,
      packageContentHash: implementation.packageName === null ? null : implementation.contentHash ?? null,
      tokenApplicability,
      snapshotAvailability,
      snapshotSourceReferenceId: null,
      codeConnectStatus,
      codeConnectArtifactAvailability: 'not-emitted',
      codeConnectExportStatus: 'not-exported',
      codeConnectSourceReferenceId: null,
      mappingCoverage: applicable ? 'none' : 'not-applicable',
      galleryNodeStatus,
      galleryNodeId,
      codeConnectNodeStatus: 'absent',
      codeConnectNodeId: null,
      nodeComparison: 'not-comparable',
      publicationStatus: 'not-evidenced',
      designSkillAvailability: designSkill.availability,
      designSkillSourceReferenceId: null,
      designSkillUnavailableReason: designSkill.reason,
    }
  }

  const nodeIds = joined.map((mapping) => normalizeFigmaNodeId(mapping.nodeId)).filter((id) => id !== null)
  const placeholderOnly = joined.every((mapping) => mapping.placeholder)
  const realNodeIds = joined
    .filter((mapping) => !mapping.placeholder)
    .map((mapping) => normalizeFigmaNodeId(mapping.nodeId))
    .filter((id) => id !== null)

  const codeConnectNodeId = realNodeIds.length > 0 ? realNodeIds[0] : (nodeIds.length > 0 ? nodeIds[0] : null)
  const codeConnectNodeStatus = realNodeIds.length > 0
    ? 'known'
    : (nodeIds.length > 0 ? 'placeholder' : 'absent')

  let nodeComparison = 'not-comparable'
  if (galleryNodeStatus === 'known' && codeConnectNodeStatus === 'known') {
    nodeComparison = galleryNodeId === codeConnectNodeId ? 'match' : 'mismatch'
  }

  // Coverage compares two real declarations: the values the mapping binds and the variants the
  // gallery renders. A mapping that binds nothing has nothing to compare, which is `unverified`
  // rather than a coverage claim in either direction.
  const mappedValues = new Set(joined.flatMap((mapping) => mapping.mappedPropValues))
  let mappingCoverage
  if (mappedValues.size === 0) {
    mappingCoverage = 'unverified'
  } else {
    const covered = entry.variantIds.filter((variantId) => mappedValues.has(variantId))
    if (entry.variantIds.length > 0 && covered.length === entry.variantIds.length) mappingCoverage = 'complete'
    else if (covered.length > 0) mappingCoverage = 'partial'
    else mappingCoverage = 'unverified'
  }
  if (placeholderOnly && mappingCoverage === 'complete') {
    // A placeholder node means the mapping is not anchored to a real Figma component yet, so a
    // value match cannot be promoted to complete coverage of something unidentified.
    mappingCoverage = 'partial'
  }

  const sourceRelativePath = joined[0].sourceRelativePath
  return {
    prUrl: FOUNDATION_PR_URL,
    landedPrUrl: FOUNDATION_LANDED_PR_URL,
    auditedHeadSha: FOUNDATION_AUDITED_HEAD_SHA,
    baselineSha: FOUNDATION_BASELINE_SHA,
    packageName: CODE_CONNECT_PACKAGE,
    packageVersion: packageVersions[CODE_CONNECT_PACKAGE] ?? null,
    packageContentHash: null,
    tokenApplicability,
    snapshotAvailability,
    snapshotSourceReferenceId: null,
    codeConnectStatus: 'mapped',
    codeConnectArtifactAvailability: codeConnect.packed.has(sourceRelativePath)
      ? 'installed-packed-auxiliary'
      : 'not-emitted',
    codeConnectExportStatus: codeConnect.exported.has(sourceRelativePath) ? 'exported' : 'not-exported',
    codeConnectSourceReferenceId: installedPathOf(CODE_CONNECT_PACKAGE, sourceRelativePath),
    mappingCoverage,
    galleryNodeStatus,
    galleryNodeId,
    codeConnectNodeStatus,
    codeConnectNodeId,
    nodeComparison,
    publicationStatus: 'not-evidenced',
    designSkillAvailability: designSkill.availability,
    designSkillSourceReferenceId: null,
    designSkillUnavailableReason: designSkill.reason,
  }
}

/**
 * The closed cross-facet tuples of a `designFoundation` record.
 *
 * Every impossible combination must fail generation rather than ship. This is the guard that
 * makes the record a contract instead of a bag of independently-settable strings.
 */
export function foundationTupleErrors(id, foundation) {
  const errors = []
  const fail = (message) => errors.push(`${id}: ${message}`)

  const {
    codeConnectStatus, codeConnectArtifactAvailability, codeConnectExportStatus,
    codeConnectSourceReferenceId, codeConnectNodeStatus, codeConnectNodeId,
    mappingCoverage, galleryNodeStatus, galleryNodeId, nodeComparison,
    snapshotAvailability, snapshotSourceReferenceId,
    designSkillAvailability, designSkillSourceReferenceId, publicationStatus,
  } = foundation

  if (codeConnectStatus === 'mapped') {
    if (codeConnectArtifactAvailability !== 'installed-packed-auxiliary') {
      fail('mapped requires an installed packed auxiliary artifact')
    }
    if (codeConnectSourceReferenceId === null) fail('mapped requires exactly one Code Connect source id')
    if (!['known', 'placeholder'].includes(codeConnectNodeStatus)) {
      fail('mapped requires a known or placeholder Code Connect node')
    }
    if (!['complete', 'partial', 'unverified'].includes(mappingCoverage)) {
      fail(`mapped requires complete, partial or unverified coverage, not "${mappingCoverage}"`)
    }
  }
  if (codeConnectStatus === 'unmapped') {
    if (codeConnectArtifactAvailability !== 'not-emitted') fail('unmapped requires not-emitted')
    if (codeConnectExportStatus !== 'not-exported') fail('unmapped requires not-exported')
    if (codeConnectSourceReferenceId !== null) fail('unmapped must carry no Code Connect source id')
    if (codeConnectNodeId !== null) fail('unmapped must carry no Code Connect node id')
    if (codeConnectNodeStatus !== 'absent') fail('unmapped requires an absent Code Connect node')
    if (mappingCoverage !== 'none') fail('unmapped requires mappingCoverage "none"')
  }
  if (codeConnectStatus === 'not-applicable') {
    if (codeConnectSourceReferenceId !== null) fail('not-applicable must carry no Code Connect source id')
    if (codeConnectNodeId !== null) fail('not-applicable must carry no Code Connect node id')
    if (codeConnectArtifactAvailability !== 'not-emitted') fail('not-applicable requires not-emitted')
    if (codeConnectExportStatus !== 'not-exported') fail('not-applicable requires not-exported')
    if (codeConnectNodeStatus !== 'absent') fail('not-applicable requires an absent Code Connect node')
    if (mappingCoverage !== 'not-applicable') fail('not-applicable requires mappingCoverage "not-applicable"')
  }

  if (codeConnectNodeStatus === 'absent' && codeConnectNodeId !== null) {
    fail('an absent Code Connect node cannot carry a node id')
  }
  if (galleryNodeStatus === 'absent' && galleryNodeId !== null) {
    fail('an absent gallery node cannot carry a node id')
  }
  if (galleryNodeStatus === 'known' && galleryNodeId === null) {
    fail('a known gallery node requires a normalized node id')
  }

  const bothKnown = galleryNodeStatus === 'known' && codeConnectNodeStatus === 'known'
  if (nodeComparison === 'match' && (!bothKnown || galleryNodeId !== codeConnectNodeId)) {
    fail('match requires two known, equal normalized node ids')
  }
  if (nodeComparison === 'mismatch' && (!bothKnown || galleryNodeId === codeConnectNodeId)) {
    fail('mismatch requires two known, unequal normalized node ids')
  }
  if (nodeComparison === 'not-comparable' && bothKnown) {
    fail('two known node ids must compare as match or mismatch')
  }

  if (snapshotAvailability !== 'emitted' && snapshotSourceReferenceId !== null) {
    fail('a snapshot source id exists only for an emitted snapshot')
  }
  if (designSkillAvailability !== 'emitted-opt-in' && designSkillSourceReferenceId !== null) {
    fail('a design-skill source id exists only for an emitted opt-in skill')
  }
  if (publicationStatus !== 'not-evidenced') {
    fail('publicationStatus is closed at not-evidenced until a spec amendment defines external evidence')
  }
  return errors
}

function buildInventory(root) {
  const errors = []
  const gallery = readGallery(root)
  const mappings = readCodeConnectMappings(root)

  if (!isAncestor(root, FOUNDATION_BASELINE_SHA)) {
    errors.push(
      `the design-foundation baseline ${FOUNDATION_BASELINE_SHA} is not an ancestor of HEAD; `
      + 'the sidecar cannot claim a baseline this tree does not contain',
    )
  }

  const packageVersions = {
    [GALLERY_PACKAGE]: readJson(path.join(root, GALLERY_WORKSPACE_DIR, 'package.json')).version,
    [CODE_CONNECT_PACKAGE]: readJson(path.join(root, CODE_CONNECT_WORKSPACE_DIR, 'package.json')).version,
  }

  // What `@open-mercato/ui` packs, and what it actually exports. These are different questions:
  // the Code Connect files are packed but live outside `src/`, and every export pattern in the
  // package maps into `src/`, so no public specifier can reach them. "Packed" never implies
  // "importable", and this asset records the two separately.
  const codeConnectPacked = new Set()
  const codeConnectExported = new Set()
  for (const mapping of mappings) {
    if (isPacked(root, CODE_CONNECT_WORKSPACE_DIR, mapping.sourceRelativePath) === true) {
      codeConnectPacked.add(mapping.sourceRelativePath)
    }
    const specifier = `${CODE_CONNECT_PACKAGE}/${mapping.sourceRelativePath.replace(/\.tsx$/, '')}`
    if (resolvePackageExport(root, CODE_CONNECT_WORKSPACE_DIR, CODE_CONNECT_PACKAGE, specifier) !== null) {
      codeConnectExported.add(mapping.sourceRelativePath)
    }
  }

  const availabilityByPreset = readPresetAvailability(root)
  const designSkill = readDesignSkillAvailability(root)

  const items = []
  for (const entry of gallery.entries) {
    const id = `${entry.familyId}/${entry.entryId}`
    const entrySource = galleryEntrySource(root, entry)
    if (entrySource.packed !== true) {
      errors.push(`${id}: its gallery entry source ${entrySource.packageRelativePath} is not packed by ${GALLERY_PACKAGE}`)
    }
    const implementation = resolveImplementation(root, entry)
    if (implementation.kind === 'installed-package' && implementation.packed !== true) {
      errors.push(`${id}: ${implementation.packageRelativePath} is not packed by ${implementation.packageName}`)
    }

    const designFoundation = buildDesignFoundation({
      entry,
      implementation,
      mappings,
      packageVersions,
      codeConnect: { packed: codeConnectPacked, exported: codeConnectExported },
      designSkill,
    })
    errors.push(...foundationTupleErrors(id, designFoundation))

    items.push({
      galleryItemId: id,
      familyId: entry.familyId,
      entryId: entry.entryId,
      title: entry.title,
      importPath: entry.importPath,
      entrySource: entrySource.installedPath,
      implementationKind: implementation.kind,
      implementationSource: implementation.installedPath,
      localTokenSource: implementation.localTokenSource,
      variantIds: entry.variantIds,
      route: `${GALLERY_ROUTE_BASE}?family=${entry.familyId}&entry=${entry.entryId}`,
      availabilityByPreset,
      featureId: GALLERY_FEATURE_ID,
      baselinePrUrl: GALLERY_PR_URL,
      designFoundation,
    })
  }

  const seen = new Set()
  for (const item of items) {
    if (seen.has(item.galleryItemId)) errors.push(`${item.galleryItemId}: duplicate gallery item id`)
    seen.add(item.galleryItemId)
  }

  const mappedItems = items.filter((item) => item.designFoundation.codeConnectStatus === 'mapped')
  const inventory = {
    version: 1,
    generatedNote:
      'Derived design-system reference inventory for the PR #4301 gallery and its PR #4891 design '
      + 'foundation sidecar. Never hand-edit: regenerate with '
      + '`yarn workspace create-mercato-app harness:generate-design-system-inventory`. Every field is '
      + 'computed from the packed registry, the real `figma.connect` calls and the real `npm pack` '
      + 'file lists. `entrySource` and `implementationSource` are installed, app-relative, read-only '
      + 'paths. `codeConnectExportStatus` answers importability, which is NOT implied by being '
      + 'packed. `publicationStatus` is closed at `not-evidenced`: nothing in this repository can '
      + 'evidence an external Figma publication.',
    inputs: {
      galleryRegistry: installedPathOf(GALLERY_PACKAGE, `${GALLERY_DIR}/registry.ts`),
      galleryTypes: installedPathOf(GALLERY_PACKAGE, `${GALLERY_DIR}/types.ts`),
      galleryPrUrl: GALLERY_PR_URL,
      foundationPrUrl: FOUNDATION_PR_URL,
      foundationLandedPrUrl: FOUNDATION_LANDED_PR_URL,
      foundationBaselineSha: FOUNDATION_BASELINE_SHA,
      foundationAuditedHeadSha: FOUNDATION_AUDITED_HEAD_SHA,
      packageVersions,
    },
    derived: {
      familyCount: gallery.families.length,
      familyIds: gallery.families.map((family) => family.id),
      itemCount: items.length,
      variantCount: items.reduce((total, item) => total + item.variantIds.length, 0),
      installedImplementationCount: items.filter((item) => item.implementationKind === 'installed-package').length,
      localTokenItemCount: items.filter((item) => item.implementationKind === 'app-local-token').length,
      externalImplementationCount: items.filter((item) => item.implementationKind === 'external-package').length,
      codeConnectCallCount: mappings.length,
      codeConnectPlaceholderCallCount: mappings.filter((mapping) => mapping.placeholder).length,
      mappedItemCount: mappedItems.length,
      nodeComparisonCounts: {
        match: items.filter((item) => item.designFoundation.nodeComparison === 'match').length,
        mismatch: items.filter((item) => item.designFoundation.nodeComparison === 'mismatch').length,
        'not-comparable': items.filter((item) => item.designFoundation.nodeComparison === 'not-comparable').length,
      },
      designSkillAvailability: designSkill.availability,
      availabilityByPreset,
    },
    notEvidenced: [
      'External Figma publication. Parse and type success are not publication proof, so every '
      + 'record closes at `publicationStatus: "not-evidenced"`.',
      'The PR #4277 audited head is provenance only — that pull request was closed and merged '
      + 'nothing. This tree contains its content as PR #4891 at the recorded baseline, which is '
      + 'checked to be an ancestor of HEAD on every run.',
      'No local token snapshot is emitted, so `snapshotAvailability` is `unavailable` everywhere. '
      + 'Emitting one requires parity proof against the app-local stylesheet.',
    ],
    items,
  }
  return { errors, inventory }
}

/**
 * The app-facing projection.
 *
 * A scaffolded app has no use for monorepo provenance or repository-only counts, and a blanked
 * field reads as a real empty one, so repository-only fields are dropped rather than emptied.
 */
export const PROJECTED_ITEM_FIELDS = Object.freeze([
  'galleryItemId', 'familyId', 'entryId', 'title', 'importPath', 'entrySource',
  'implementationKind', 'implementationSource', 'localTokenSource', 'variantIds', 'route',
  'availabilityByPreset', 'featureId', 'designFoundation',
])

export function projectInventory(inventory) {
  return {
    version: inventory.version,
    generatedNote: inventory.generatedNote,
    derived: inventory.derived,
    notEvidenced: inventory.notEvidenced,
    items: inventory.items.map((item) => {
      const projected = {}
      for (const field of PROJECTED_ITEM_FIELDS) projected[field] = item[field]
      return projected
    }),
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check')
  let root
  try {
    root = repositoryRoot()
  } catch (error) {
    console.error(`design-system-inventory: cannot resolve repository root: ${error.message}`)
    return EXIT_INVALID
  }

  let built
  try {
    built = buildInventory(root)
  } catch (error) {
    console.error(`design-system-inventory: cannot derive the inventory: ${error.message}`)
    return EXIT_INVALID
  }

  for (const error of built.errors) console.error(`design-system-inventory: ${error}`)
  if (built.errors.length > 0) {
    console.log('FAIL design-system-inventory')
    return EXIT_FAILURE
  }

  const outputs = [
    [INVENTORY_RELATIVE_PATH, serialize(built.inventory)],
    [PROJECTION_RELATIVE_PATH, serialize(projectInventory(built.inventory))],
  ]
  for (const [relative, serialized] of outputs) {
    const absolute = path.join(root, relative)
    if (check) {
      let existing
      try {
        existing = fs.readFileSync(absolute, 'utf8')
      } catch {
        console.error(`design-system-inventory: ${relative} is missing; regenerate it`)
        console.log('FAIL design-system-inventory')
        return EXIT_FAILURE
      }
      if (existing !== serialized) {
        console.error(
          `design-system-inventory: ${relative} is stale — checked ${sha256(existing)}, derived ${sha256(serialized)}`,
        )
        console.log('FAIL design-system-inventory')
        return EXIT_FAILURE
      }
    } else {
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, serialized)
    }
  }

  const derived = built.inventory.derived
  console.log(
    `PASS design-system-inventory — ${derived.itemCount} items across ${derived.familyCount} families, `
    + `${derived.mappedItemCount} Code Connect mapped, `
    + `${derived.nodeComparisonCounts.match} node match / ${derived.nodeComparisonCounts.mismatch} mismatch`,
  )
  return EXIT_PASS
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main()
}
