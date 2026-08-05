import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// @ts-expect-error - plain ESM script, deliberately outside the published `src` tree
import {
  INVENTORY_RELATIVE_PATH,
  PROJECTED_ITEM_FIELDS,
  PROJECTION_RELATIVE_PATH,
  foundationTupleErrors,
  main,
} from '../../scripts/generate-design-system-inventory.mjs'
// @ts-expect-error - see above
import {
  normalizeFigmaNodeId,
  readCodeConnectMappings,
  readGallery,
  resolvePackageExport,
} from '../../scripts/design-system-sources.mjs'

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)))

type Foundation = Record<string, unknown>
type Item = {
  galleryItemId: string
  familyId: string
  entryId: string
  importPath: string
  entrySource: string
  implementationKind: string
  implementationSource: string | null
  localTokenSource: string | null
  route: string
  availabilityByPreset: Record<string, string>
  featureId: string
  designFoundation: Foundation
}

function readInventory(relative: string): { derived: Record<string, unknown>; items: Item[] } {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8'))
}

/** A `designFoundation` that satisfies every closed tuple, as the starting point for negatives. */
function soundFoundation(): Foundation {
  return {
    codeConnectStatus: 'unmapped',
    codeConnectArtifactAvailability: 'not-emitted',
    codeConnectExportStatus: 'not-exported',
    codeConnectSourceReferenceId: null,
    codeConnectNodeStatus: 'absent',
    codeConnectNodeId: null,
    mappingCoverage: 'none',
    galleryNodeStatus: 'absent',
    galleryNodeId: null,
    nodeComparison: 'not-comparable',
    snapshotAvailability: 'unavailable',
    snapshotSourceReferenceId: null,
    designSkillAvailability: 'unavailable',
    designSkillSourceReferenceId: null,
    publicationStatus: 'not-evidenced',
  }
}

test('the checked design-system inventory is exactly what the generator derives', () => {
  const exitCode = main(['--check'])
  assert.equal(
    exitCode,
    0,
    'the checked inventory is stale — regenerate with '
      + '`yarn workspace create-mercato-app harness:generate-design-system-inventory`',
  )
})

test('the inventory covers every entry the gallery registry really lists', () => {
  const gallery = readGallery(REPO_ROOT)
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)

  const derivedIds = gallery.entries.map((entry: { familyId: string; entryId: string }) =>
    `${entry.familyId}/${entry.entryId}`)
  assert.deepEqual(inventory.items.map((item) => item.galleryItemId), derivedIds)
  assert.equal(new Set(derivedIds).size, derivedIds.length, 'gallery item ids must be unique')
})

test('every installed source the inventory names is a real packed file, not a guess', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  for (const item of inventory.items) {
    // The entry's own source is always an installed gallery file.
    assert.match(item.entrySource, /^node_modules\/@open-mercato\/core\/src\/modules\/design_system\/gallery\/entries\/[a-z-]+\.tsx$/)
    const entryWorkspacePath = item.entrySource.replace('node_modules/@open-mercato/core/', 'packages/core/')
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, entryWorkspacePath)),
      `${item.galleryItemId}: ${item.entrySource} does not exist in the workspace`,
    )

    if (item.implementationKind === 'installed-package') {
      assert.ok(item.implementationSource, `${item.galleryItemId} must name its implementation`)
      const workspacePath = item.implementationSource!.replace(
        /^node_modules\/@open-mercato\/([^/]+)\//,
        'packages/$1/',
      )
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, workspacePath)),
        `${item.galleryItemId}: ${item.implementationSource} does not exist in the workspace`,
      )
    } else {
      assert.equal(
        item.implementationSource,
        null,
        `${item.galleryItemId} has no installed implementation and must not name one`,
      )
    }
  }
})

test('a public import that resolves to no exported file is never called installed-package', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  for (const item of inventory.items) {
    if (item.implementationKind !== 'installed-package') continue
    const resolved = resolvePackageExport(REPO_ROOT, 'packages/ui', '@open-mercato/ui', item.importPath)
      ?? resolvePackageExport(REPO_ROOT, 'packages/core', '@open-mercato/core', item.importPath)
    assert.ok(resolved, `${item.galleryItemId}: "${item.importPath}" resolves through no export`)
  }
})

test('token entries stay app-local and carry no installed implementation', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  const tokenItems = inventory.items.filter((item) => item.implementationKind === 'app-local-token')
  assert.ok(tokenItems.length > 0, 'the foundations family must contribute app-local token entries')
  for (const item of tokenItems) {
    assert.equal(item.localTokenSource, 'src/app/globals.css')
    assert.equal(item.implementationSource, null)
    assert.equal(item.designFoundation.tokenApplicability, 'local-css')
    assert.equal(item.designFoundation.codeConnectStatus, 'not-applicable')
  }
})

test('every fresh preset records the gallery route as source-only', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  const presetIds = Object.keys(inventory.items[0].availabilityByPreset)
  assert.ok(presetIds.length >= 2, 'the preset matrix must cover the real starter presets')
  for (const item of inventory.items) {
    assert.equal(item.featureId, 'design_system.view')
    assert.match(item.route, /^\/backend\/design-system\?family=[a-z-]+&entry=[a-z0-9-]+$/)
    for (const presetId of presetIds) {
      assert.equal(
        item.availabilityByPreset[presetId],
        'source-only',
        `${item.galleryItemId} must be source-only in preset ${presetId} while design_system is unregistered`,
      )
    }
  }
})

test('Code Connect mapping status is joined from real figma.connect calls', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  const mappings = readCodeConnectMappings(REPO_ROOT)
  const mappedImports = new Set(
    mappings.flatMap((mapping: { publicImportPaths: string[] }) => mapping.publicImportPaths),
  )

  for (const item of inventory.items) {
    const status = item.designFoundation.codeConnectStatus
    if (item.implementationKind !== 'installed-package') {
      assert.equal(status, 'not-applicable', `${item.galleryItemId} has no installed implementation`)
      continue
    }
    assert.equal(
      status,
      mappedImports.has(item.importPath) ? 'mapped' : 'unmapped',
      `${item.galleryItemId} mapping status must follow the real figma.connect calls`,
    )
  }
})

test('the Code Connect files are packed but not importable, and the record says both', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  const mapped = inventory.items.filter((item) => item.designFoundation.codeConnectStatus === 'mapped')
  assert.ok(mapped.length > 0, 'the tree ships figma.connect mappings')

  for (const item of mapped) {
    assert.equal(item.designFoundation.codeConnectArtifactAvailability, 'installed-packed-auxiliary')
    // Every export pattern in `@open-mercato/ui` maps into `./src/**`, and the Code Connect files
    // live outside `src/`. Packed is not importable, and conflating the two is the failure this
    // field exists to prevent.
    assert.equal(item.designFoundation.codeConnectExportStatus, 'not-exported')
    const reference = item.designFoundation.codeConnectSourceReferenceId as string
    assert.match(reference, /^node_modules\/@open-mercato\/ui\/figma\/[a-z-]+\.figma\.tsx$/)
    assert.equal(
      resolvePackageExport(
        REPO_ROOT,
        'packages/ui',
        '@open-mercato/ui',
        reference.replace('node_modules/', '').replace(/\.tsx$/, ''),
      ),
      null,
      'a file the package really exported would have to be recorded as exported',
    )
  }
})

test('the two node authorities stay independent', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  for (const item of inventory.items) {
    const f = item.designFoundation as Record<string, string | null>
    // A gallery node never promotes an unmapped or placeholder Code Connect record...
    if (f.codeConnectStatus !== 'mapped') assert.equal(f.codeConnectNodeId, null)
    // ...and a Code Connect node never fabricates gallery metadata.
    if (f.galleryNodeStatus === 'absent') assert.equal(f.galleryNodeId, null)
    if (f.nodeComparison === 'match') {
      assert.equal(f.galleryNodeId, f.codeConnectNodeId)
      assert.equal(f.galleryNodeStatus, 'known')
      assert.equal(f.codeConnectNodeStatus, 'known')
    }
  }
})

test('normalizing node ids reconciles the colon and hyphen forms without inventing ids', () => {
  assert.equal(normalizeFigmaNodeId('486-7366'), '486:7366')
  assert.equal(normalizeFigmaNodeId('486:7366'), '486:7366')
  assert.equal(normalizeFigmaNodeId('0-1'), '0:1')
  assert.equal(normalizeFigmaNodeId(''), null)
  assert.equal(normalizeFigmaNodeId(undefined), null)
  assert.equal(normalizeFigmaNodeId('not-a-node'), null)
})

test('publication is never evidenced from this repository', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  for (const item of inventory.items) {
    assert.equal(item.designFoundation.publicationStatus, 'not-evidenced')
  }
})

test('the design skill stays unavailable while no portable copy is emitted', () => {
  const inventory = readInventory(INVENTORY_RELATIVE_PATH)
  const emitted = fs.existsSync(
    path.join(REPO_ROOT, 'packages/create-app/agentic/shared/ai/skills/om-figma-design-with-ds'),
  )
  const expected = emitted ? 'emitted-opt-in' : 'unavailable'
  for (const item of inventory.items) {
    assert.equal(item.designFoundation.designSkillAvailability, expected)
    if (expected === 'unavailable') {
      assert.equal(item.designFoundation.designSkillSourceReferenceId, null)
    }
  }
})

test('the app projection drops repository-only fields instead of blanking them', () => {
  const full = readInventory(INVENTORY_RELATIVE_PATH)
  const projection = readInventory(PROJECTION_RELATIVE_PATH)
  assert.equal(projection.items.length, full.items.length)

  for (const item of projection.items) {
    assert.deepEqual(Object.keys(item), [...PROJECTED_ITEM_FIELDS])
    // A blanked field reads as a real empty one; dropped is the only honest projection.
    assert.ok(!('baselinePrUrl' in item), 'repository-only provenance must be dropped, not blanked')
  }
})

test('every impossible designFoundation tuple fails generation', () => {
  assert.deepEqual(foundationTupleErrors('sound', soundFoundation()), [])

  const cases: Array<[string, Foundation]> = [
    ['mapped without a packed artifact', {
      ...soundFoundation(),
      codeConnectStatus: 'mapped',
      codeConnectSourceReferenceId: 'node_modules/@open-mercato/ui/figma/alert.figma.tsx',
      codeConnectNodeStatus: 'placeholder',
      codeConnectNodeId: '0:1',
      mappingCoverage: 'unverified',
    }],
    ['unmapped that still names a Code Connect source', {
      ...soundFoundation(),
      codeConnectSourceReferenceId: 'node_modules/@open-mercato/ui/figma/alert.figma.tsx',
    }],
    ['unmapped with coverage other than none', { ...soundFoundation(), mappingCoverage: 'partial' }],
    ['not-applicable carrying a node id', {
      ...soundFoundation(),
      codeConnectStatus: 'not-applicable',
      mappingCoverage: 'not-applicable',
      codeConnectNodeId: '1:2',
    }],
    ['an absent gallery node with an id', { ...soundFoundation(), galleryNodeId: '1:2' }],
    ['a known gallery node without an id', { ...soundFoundation(), galleryNodeStatus: 'known' }],
    ['match without two known equal ids', { ...soundFoundation(), nodeComparison: 'match' }],
    ['mismatch without two known ids', { ...soundFoundation(), nodeComparison: 'mismatch' }],
    ['two known equal ids called not-comparable', {
      ...soundFoundation(),
      codeConnectStatus: 'mapped',
      codeConnectArtifactAvailability: 'installed-packed-auxiliary',
      codeConnectSourceReferenceId: 'node_modules/@open-mercato/ui/figma/drawer.figma.tsx',
      mappingCoverage: 'unverified',
      galleryNodeStatus: 'known',
      galleryNodeId: '486:7366',
      codeConnectNodeStatus: 'known',
      codeConnectNodeId: '486:7366',
      nodeComparison: 'not-comparable',
    }],
    ['a snapshot id without an emitted snapshot', {
      ...soundFoundation(),
      snapshotSourceReferenceId: '.ai/design/tokens.md',
    }],
    ['a design-skill id while the skill is unavailable', {
      ...soundFoundation(),
      designSkillSourceReferenceId: '.agents/skills/om-figma-design-with-ds/SKILL.md',
    }],
    ['a published record', { ...soundFoundation(), publicationStatus: 'published' }],
  ]

  for (const [label, foundation] of cases) {
    const errors = foundationTupleErrors('probe', foundation)
    assert.ok(errors.length > 0, `${label} must be rejected`)
  }
})
