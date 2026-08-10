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
 * Every mutable surface fact is derived. Family counts, entry counts, mapping counts and coverage
 * sets are computed from the real registry, the real `figma.connect` calls and the real `npm pack`
 * file lists — never copied from the spec's prose. Immutable PR provenance is fixed here and its
 * merged baselines must be ancestors of HEAD. External Figma publication cannot be derived from
 * this repository, so `publicationStatus` is closed at `not-evidenced` and adding a published state
 * needs a spec amendment.
 *
 * Usage:
 *   node scripts/generate-design-system-inventory.mjs           # write the inventory
 *   node scripts/generate-design-system-inventory.mjs --check   # regenerate and diff (no write)
 *
 * The `harness:generate-design-system-inventory` / `harness:check-design-system-inventory` package
 * scripts are convenience aliases for those two invocations; no CI step invokes either one. Staleness
 * is enforced from the test suite instead — `src/lib/design-system-inventory.test.ts` calls
 * `main(['--check'])` directly — and the derived asset is compared against the live runtime registry
 * by `packages/core/src/modules/design_system/gallery/__tests__/inventory-parity.test.ts`, which
 * `scripts/repo-wide-guards.mjs` runs unconditionally because the turbo filter cannot select it from
 * a change to this reader.
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
export const SURFACE_PROJECTION_RELATIVE_PATHS = Object.freeze([
  'apps/mercato/src/modules/example/references/surface-inventory.json',
  'packages/create-app/template/src/modules/example/references/surface-inventory.json',
])

/** The gallery implementation chain. */
export const GALLERY_PR_URL = 'https://github.com/open-mercato/open-mercato/pull/4301'
export const GALLERY_PROVENANCE_HEAD_SHA = '186af58044c7530885a889c41f53bb36a5093d82'
export const GALLERY_BASELINE_SHA = 'bf25803d7a8c85c8552db9e76c7cc4398d1768be'

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

export function provenanceAncestorErrors(root) {
  const errors = []
  if (!isAncestor(root, GALLERY_BASELINE_SHA)) {
    errors.push(
      `the design-system gallery baseline ${GALLERY_BASELINE_SHA} is not an ancestor of HEAD; `
      + 'the inventory cannot claim a baseline this tree does not contain',
    )
  }
  if (!isAncestor(root, FOUNDATION_BASELINE_SHA)) {
    errors.push(
      `the design-foundation baseline ${FOUNDATION_BASELINE_SHA} is not an ancestor of HEAD; `
      + 'the sidecar cannot claim a baseline this tree does not contain',
    )
  }
  return errors
}

function readJson(absolute) {
  return JSON.parse(fs.readFileSync(absolute, 'utf8'))
}

export function availabilityFromResolvedPresets(resolvedPresets, registeredInTemplate) {
  const availability = {}
  for (const preset of [...resolvedPresets].sort((left, right) => left.id.localeCompare(right.id))) {
    const moduleIds = preset.isClassic && registeredInTemplate
      ? new Set([GALLERY_MODULE_ID])
      : new Set(preset.modules.map((module) => module.id))
    availability[preset.id] = moduleIds.has(GALLERY_MODULE_ID) ? 'live' : 'source-only'
  }
  return availability
}

/**
 * The starter presets a fresh app can be scaffolded with, and whether each registers the gallery.
 *
 * Read from the preset definitions rather than assumed: "every fresh preset is source-only" is a
 * claim about code, and the moment a preset registers `design_system` this asset must say `live`
 * for it instead of repeating the old sentence.
 */
function readPresetAvailability(root) {
  const presetsUrl = pathToFileURL(path.join(root, 'packages/create-app/src/lib/starter-presets.ts')).href
  const resolverUrl = pathToFileURL(path.join(root, 'packages/create-app/src/lib/apply-starter-preset.ts')).href
  const probe = [
    `import { VALID_PRESET_IDS } from ${JSON.stringify(presetsUrl)}`,
    `import { resolvePreset } from ${JSON.stringify(resolverUrl)}`,
    'process.stdout.write(JSON.stringify(VALID_PRESET_IDS.map((presetId) => resolvePreset(presetId))))',
  ].join(';')
  const resolvedPresets = JSON.parse(execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', probe],
    { cwd: root, encoding: 'utf8' },
  ))
  if (resolvedPresets.length === 0) throw new Error('the starter preset resolver returned no presets')

  // `classic` is deliberately a no-op resolver result: the scaffolder preserves the template's
  // module registry for it. Every other preset replaces that file with the resolver's modules.
  const templateModules = fs.readFileSync(
    path.join(root, 'packages/create-app/template/src/modules.ts'),
    'utf8',
  )
  const registeredInTemplate = new RegExp(`id: '${GALLERY_MODULE_ID}'`).test(templateModules)
  return availabilityFromResolvedPresets(resolvedPresets, registeredInTemplate)
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

export const SURFACE_INVENTORY_RELATIVE_PATH =
  'apps/mercato/src/modules/example/references/surface-inventory.json'

/** The `@open-mercato` specifiers a source file imports, with the symbols taken from each. */
function importedSymbols(root, appRelativePath) {
  const source = fs.readFileSync(path.join(root, 'apps/mercato', appRelativePath), 'utf8')
  const found = new Map()
  const pattern = /import\s+(type\s+)?(?:\{([^}]*)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+'(@open-mercato\/[^']+)'/g
  for (const match of source.matchAll(pattern)) {
    const [, typeOnly, named, defaultName, namespaceName, specifier] = match
    // Type-only bindings never render anything. Keeping them would let a generic type argument
    // such as `useState<FilterValues>` read as a JSX element and manufacture a visual reference
    // for a type — which is how a mapping starts describing something no user ever sees.
    if (typeOnly !== undefined) continue
    const symbols = named !== undefined
      ? named
        .split(',')
        .filter((part) => !/^\s*type\s+/.test(part))
        .map((part) => part.split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
      : [defaultName ?? namespaceName].filter(Boolean)
    const existing = found.get(specifier) ?? new Set()
    for (const symbol of symbols) existing.add(symbol)
    found.set(specifier, existing)
  }
  return found
}

/**
 * Narrow a barrel import to the gallery entries the example really uses.
 *
 * Several gallery entries share one public module (`@open-mercato/ui/backend/detail` covers six).
 * Claiming all six because the example imports one of them would overstate the mapping, so the
 * candidates are narrowed by whether the imported symbol appears in an entry's own copyable
 * snippet. When nothing narrows, the whole set is kept rather than a guess being made.
 */
function narrowEntriesBySymbol(candidates, symbols) {
  if (candidates.length <= 1) return candidates
  const narrowed = candidates.filter((entry) =>
    entry.variantSnippets.some((snippet) => [...symbols].some((symbol) => snippet.includes(`<${symbol}`))))
  return narrowed.length > 0 ? narrowed : candidates
}

/**
 * The design-system reference records for one canonical example UI row.
 *
 * A public component the example imports maps **direct** when the merged gallery contains an entry
 * for that exact public module. When it does not, the mapping is **composite-not-direct**: the row
 * resolves the exact composite implementation and the constituent entries that implementation
 * really imports. Nothing is invented in either direction — a composite never claims the gallery
 * renders it, and a missing constituent set is reported rather than filled in.
 */
function buildReferencesForRow({ root, row, entriesByImport, galleryItemsById, availabilityByPreset }) {
  const errors = []
  const references = []
  const gaps = []

  for (const sourcePath of row.sourcePaths.filter((candidate) => candidate.endsWith('.tsx'))) {
    const imports = importedSymbols(root, sourcePath)
    const exampleSource = fs.readFileSync(path.join(root, 'apps/mercato', sourcePath), 'utf8')
    for (const [importPath, symbols] of [...imports].sort(([left], [right]) => left.localeCompare(right))) {
      if (!importPath.startsWith('@open-mercato/ui/')) continue

      // The mapping is exhaustive for canonical example UI, not for every helper the file imports.
      // "UI" is decided by what the example actually renders — a symbol used as a JSX element —
      // rather than by an allowlist of module names that would drift the moment either side moved.
      const rendered = [...symbols].filter((symbol) =>
        new RegExp(`<${symbol}[\\s/>.]`).test(exampleSource))
      if (rendered.length === 0) continue
      const implementation = resolvePackageExport(
        root, CODE_CONNECT_WORKSPACE_DIR, CODE_CONNECT_PACKAGE, importPath,
      )
      if (implementation === null) continue

      const candidates = entriesByImport.get(importPath) ?? []
      // A barrel module can hold entries for components the example does not render. Claiming
      // direct coverage from the module alone would credit the gallery for a component it never
      // shows — a false direct claim. Direct coverage therefore needs either an unambiguous
      // one-entry module or an entry whose own snippet renders the symbol in hand.
      const narrowed = candidates.length === 1
        ? candidates
        : candidates.filter((entry) => entry.variantSnippets.some((snippet) =>
          rendered.some((symbol) => snippet.includes(`<${symbol}`))))
      const direct = narrowed.length > 0 ? narrowed : []
      if (direct.length > 0) {
        references.push({
          capabilityId: row.capabilityId,
          exampleSource: `src/modules/example/${sourcePath.replace(/^src\/modules\/example\//, '')}`,
          publicImportPath: importPath,
          exportNames: rendered.sort(),
          galleryCoverage: 'direct',
          galleryEntries: direct.map((entry) => ({
            familyId: entry.familyId,
            entryId: entry.entryId,
            importPath: entry.importPath,
            entrySource: galleryItemsById.get(`${entry.familyId}/${entry.entryId}`).entrySource,
          })),
          compositeImplementationSource: null,
          implementationSource: installedPathOf(CODE_CONNECT_PACKAGE, implementation),
          availabilityByPreset,
          featureId: GALLERY_FEATURE_ID,
          baselinePrUrl: GALLERY_PR_URL,
          provenanceHeadSha: GALLERY_PROVENANCE_HEAD_SHA,
          baselineSha: GALLERY_BASELINE_SHA,
        })
        continue
      }

      // No direct entry: prove it really is absent, then resolve the composite's own constituents.
      const constituents = []
      const compositeSource = fs.readFileSync(path.join(root, CODE_CONNECT_WORKSPACE_DIR, implementation), 'utf8')
      for (const [candidateImport, entries] of entriesByImport) {
        const relative = candidateImport.startsWith(`${CODE_CONNECT_PACKAGE}/`)
          ? candidateImport.slice(CODE_CONNECT_PACKAGE.length + 1)
          : null
        if (relative === null) continue
        const importedByComposite = compositeSource.includes(`'${candidateImport}'`)
          || new RegExp(`from '\\.{1,2}/[^']*${relative.split('/').pop()}'`).test(compositeSource)
        if (importedByComposite) constituents.push(...entries)
      }
      if (constituents.length === 0) {
        // A rendered public component the gallery neither covers directly nor reaches through a
        // constituent. It is recorded as a named gap rather than mapped: guessing a direct entry
        // is exactly what the spec forbids, and failing the whole derivation would block this
        // asset on a coverage hole that belongs to the gallery's owning module. Closing it means
        // adding the entry there, never pasting an implementation into the example.
        gaps.push({
          capabilityId: row.capabilityId,
          publicImportPath: importPath,
          renderedExportNames: rendered.sort(),
          implementationSource: installedPathOf(CODE_CONNECT_PACKAGE, implementation),
          reason: 'no gallery entry declares this public module, and its implementation imports no '
            + 'gallery-covered constituent',
        })
        continue
      }
      references.push({
        capabilityId: row.capabilityId,
        exampleSource: `src/modules/example/${sourcePath.replace(/^src\/modules\/example\//, '')}`,
        publicImportPath: importPath,
        exportNames: rendered.sort(),
        galleryCoverage: 'composite-not-direct',
        galleryEntries: constituents.map((entry) => ({
          familyId: entry.familyId,
          entryId: entry.entryId,
          importPath: entry.importPath,
          entrySource: galleryItemsById.get(`${entry.familyId}/${entry.entryId}`).entrySource,
        })),
        compositeImplementationSource: installedPathOf(CODE_CONNECT_PACKAGE, implementation),
        implementationSource: installedPathOf(CODE_CONNECT_PACKAGE, implementation),
        availabilityByPreset,
        featureId: GALLERY_FEATURE_ID,
        baselinePrUrl: GALLERY_PR_URL,
        provenanceHeadSha: GALLERY_PROVENANCE_HEAD_SHA,
        baselineSha: GALLERY_BASELINE_SHA,
      })
    }
  }
  return { errors, references, gaps }
}

function buildInventory(root) {
  const errors = []
  const gallery = readGallery(root)
  const mappings = readCodeConnectMappings(root)

  errors.push(...provenanceAncestorErrors(root))

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
      provenanceHeadSha: GALLERY_PROVENANCE_HEAD_SHA,
      baselineSha: GALLERY_BASELINE_SHA,
      designFoundation,
    })
  }

  const seen = new Set()
  for (const item of items) {
    if (seen.has(item.galleryItemId)) errors.push(`${item.galleryItemId}: duplicate gallery item id`)
    seen.add(item.galleryItemId)
  }

  // The canonical example's UI rows, mapped to the gallery. A row is "UI" because it ships a
  // rendered surface, which is a fact about its own source paths rather than a hand-kept list.
  const surfaceInventory = readJson(path.join(root, SURFACE_INVENTORY_RELATIVE_PATH))
  const galleryItemsById = new Map(items.map((item) => [item.galleryItemId, item]))
  const entriesByImport = new Map()
  for (const entry of gallery.entries) {
    if (!entriesByImport.has(entry.importPath)) entriesByImport.set(entry.importPath, [])
    entriesByImport.get(entry.importPath).push(entry)
  }

  const uiRows = surfaceInventory.capabilities.filter((row) =>
    row.referenceStatus === 'canonical' && row.sourcePaths.some((candidate) => candidate.endsWith('.tsx')))
  const references = []
  const coverageGaps = []
  const rowsWithoutVisualCoverage = []
  for (const row of uiRows) {
    const built = buildReferencesForRow({ root, row, entriesByImport, galleryItemsById, availabilityByPreset })
    errors.push(...built.errors)
    coverageGaps.push(...built.gaps)
    if (built.references.length === 0 && built.gaps.length === 0) {
      // Honest, and deliberately not an error: a rendered surface that imports no design-system
      // component has nothing to map. Fabricating a reference here would be exactly the guessed
      // direct mapping the spec forbids.
      rowsWithoutVisualCoverage.push(row.capabilityId)
    }
    references.push(...built.references)
  }

  const mappedItems = items.filter((item) => item.designFoundation.codeConnectStatus === 'mapped')
  const inventory = {
    version: 1,
    generatedNote:
      'Derived design-system reference inventory for the PR #4301 gallery and its PR #4891 design '
      + 'foundation sidecar. Never hand-edit: regenerate with '
      + '`yarn workspace create-mercato-app harness:generate-design-system-inventory`. Mutable surface '
      + 'facts are computed from the packed registry, the real `figma.connect` calls and the real '
      + '`npm pack` file lists; immutable PR baselines are verified as ancestors of HEAD. `entrySource` '
      + 'and `implementationSource` are installed, app-relative, read-only '
      + 'paths. `codeConnectExportStatus` answers importability, which is NOT implied by being '
      + 'packed. `publicationStatus` is closed at `not-evidenced`: nothing in this repository can '
      + 'evidence an external Figma publication.',
    inputs: {
      galleryRegistry: installedPathOf(GALLERY_PACKAGE, `${GALLERY_DIR}/registry.ts`),
      galleryTypes: installedPathOf(GALLERY_PACKAGE, `${GALLERY_DIR}/types.ts`),
      galleryPrUrl: GALLERY_PR_URL,
      galleryProvenanceHeadSha: GALLERY_PROVENANCE_HEAD_SHA,
      galleryBaselineSha: GALLERY_BASELINE_SHA,
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
      canonicalUiRowCount: uiRows.length,
      referenceCount: references.length,
      directReferenceCount: references.filter((reference) => reference.galleryCoverage === 'direct').length,
      compositeReferenceCount: references.filter((reference) =>
        reference.galleryCoverage === 'composite-not-direct').length,
      rowsWithoutVisualCoverage,
      coverageGapCount: coverageGaps.length,
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
    designSystemReferences: references,
    designSystemCoverageGaps: coverageGaps,
  }
  return { errors, inventory }
}

/**
 * The app-facing projection.
 *
 * A scaffolded app retains the immutable gallery provenance needed by the routing oracle while
 * repository-only counts are dropped rather than blanked.
 */
export const PROJECTED_ITEM_FIELDS = Object.freeze([
  'galleryItemId', 'familyId', 'entryId', 'title', 'importPath', 'entrySource',
  'implementationKind', 'implementationSource', 'localTokenSource', 'variantIds', 'route',
  'availabilityByPreset', 'featureId', 'baselinePrUrl', 'provenanceHeadSha', 'baselineSha',
  'designFoundation',
])

export function projectInventory(inventory) {
  return {
    version: inventory.version,
    generatedNote: inventory.generatedNote,
    derived: inventory.derived,
    notEvidenced: inventory.notEvidenced,
    designSystemReferences: inventory.designSystemReferences,
    designSystemCoverageGaps: inventory.designSystemCoverageGaps,
    items: inventory.items.map((item) => {
      const projected = {}
      for (const field of PROJECTED_ITEM_FIELDS) projected[field] = item[field]
      return projected
    }),
  }
}

export function projectSurfaceInventory(surfaceInventory, inventory) {
  const projection = projectInventory(inventory)
  const canonicalSurface = { ...surfaceInventory }
  for (const generatedField of [
    'designSystemInventoryPath',
    'designSystemGallery',
    'designSystemGalleryItems',
    'designFoundation',
    'designSystemReferences',
    'designSystemCoverageGaps',
  ]) delete canonicalSurface[generatedField]
  return {
    ...canonicalSurface,
    designSystemInventoryPath: '.ai/harness/design-system-inventory.json',
    designSystemGallery: {
      itemCount: projection.derived.itemCount,
      familyIds: projection.derived.familyIds,
      referenceCount: projection.derived.referenceCount,
      rowsWithoutVisualCoverage: projection.derived.rowsWithoutVisualCoverage,
      coverageGapCount: projection.derived.coverageGapCount,
      baselinePrUrl: GALLERY_PR_URL,
      provenanceHeadSha: GALLERY_PROVENANCE_HEAD_SHA,
      baselineSha: GALLERY_BASELINE_SHA,
    },
    designFoundation: {
      mappedItemCount: projection.derived.mappedItemCount,
      nodeComparisonCounts: projection.derived.nodeComparisonCounts,
      designSkillAvailability: projection.derived.designSkillAvailability,
      publicationStatus: 'not-evidenced',
      codeConnectArtifactAvailability: 'installed-packed-auxiliary',
      codeConnectExportStatus: 'not-exported',
    },
    designSystemReferences: projection.designSystemReferences.map((reference) => ({
      capabilityId: reference.capabilityId,
      galleryCoverage: reference.galleryCoverage,
      galleryItemIds: reference.galleryEntries.map((entry) => `${entry.familyId}/${entry.entryId}`),
      implementationSource: reference.implementationSource,
      baselinePrUrl: reference.baselinePrUrl,
      provenanceHeadSha: reference.provenanceHeadSha,
      baselineSha: reference.baselineSha,
    })),
    designSystemCoverageGaps: projection.designSystemCoverageGaps.map((gap) => ({
      capabilityId: gap.capabilityId,
      publicImportPath: gap.publicImportPath,
      reason: gap.reason,
    })),
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** What a release-version string collapses to before `--check` compares two documents. */
export const PROVENANCE_VERSION_SENTINEL = '<release-version>'

/**
 * Collapse every workspace release version to a sentinel.
 *
 * The inventory records the releasing package's version on each item as provenance — which is
 * useful to read and disastrous to compare byte-for-byte. `packageVersion` appears on 106 items
 * plus `inputs.packageVersions`, so a version bump landing on a base branch invalidates the
 * committed asset for **every** open branch carrying it, with a staleness message that points at
 * the author's own reader changes rather than at the release that actually caused it (PR #4991
 * lost an afternoon to exactly that, on `v0.6.7`).
 *
 * So `--check` compares provenance-normalized documents. The guard keeps its full strength over
 * design-system content — these are the only fields that carry a release version, and nothing
 * about the gallery, the mappings or the foundation tuples can hide behind one — while a release
 * no longer breaks unrelated branches. Generation still writes the real versions, and a checked
 * asset whose versions have drifted is reported as a NOTE so it can be refreshed deliberately.
 *
 * Returns `null` when the text is not JSON, so a corrupt checked file fails the byte comparison
 * rather than being normalized into agreement.
 */
export function normalizeProvenanceVersions(serialized) {
  let parsed
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return null
  }
  const walk = (value, key) => {
    if (Array.isArray(value)) return value.map((element) => walk(element, null))
    if (value !== null && typeof value === 'object') {
      const mapped = {}
      for (const [childKey, childValue] of Object.entries(value)) {
        mapped[childKey] = walk(childValue, childKey)
      }
      return mapped
    }
    if (key === 'packageVersion' && typeof value === 'string') return PROVENANCE_VERSION_SENTINEL
    return value
  }
  const normalized = walk(parsed, null)
  if (normalized?.inputs?.packageVersions && typeof normalized.inputs.packageVersions === 'object') {
    for (const packageName of Object.keys(normalized.inputs.packageVersions)) {
      normalized.inputs.packageVersions[packageName] = PROVENANCE_VERSION_SENTINEL
    }
  }
  return serialize(normalized)
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
  for (const relative of SURFACE_PROJECTION_RELATIVE_PATHS) {
    const current = readJson(path.join(root, relative))
    outputs.push([relative, serialize(projectSurfaceInventory(current, built.inventory))])
  }
  const provenanceDrift = []
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
        const existingContent = normalizeProvenanceVersions(existing)
        const derivedContent = normalizeProvenanceVersions(serialized)
        if (existingContent !== null && existingContent === derivedContent) {
          provenanceDrift.push(relative)
          continue
        }
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

  for (const relative of provenanceDrift) {
    console.log(
      `NOTE design-system-inventory: ${relative} differs from the derived asset only in release-version `
      + 'provenance, which a release bump on the base branch causes and no branch can be expected to '
      + 'chase. Not a failure; refresh it with `harness:generate-design-system-inventory` when convenient.',
    )
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
