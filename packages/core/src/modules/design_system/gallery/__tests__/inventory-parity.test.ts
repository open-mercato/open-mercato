import fs from 'node:fs'
import path from 'node:path'
import { galleryFamilies } from '../registry'

/**
 * The static reader behind the derived design-system inventory must agree with the registry the
 * application actually loads.
 *
 * The inventory is derived by a plain Node script, which cannot import these TSX entries (they
 * carry live render closures), so it reads them through the TypeScript compiler API instead. That
 * is a convenience, not a second authority: this test loads the real registry and asserts the
 * derived asset matches it family for family, entry for entry and variant for variant.
 *
 * Without this, a reader that quietly failed to resolve some shape would ship an inventory that
 * under-reports the gallery while every other gate stayed green — the exact silent-undercount
 * failure this programme keeps finding.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..')
const INVENTORY_PATH = path.join(
  REPO_ROOT,
  'packages/create-app/scripts/design-system/design-system-inventory.json',
)

type InventoryItem = {
  galleryItemId: string
  familyId: string
  entryId: string
  title: string
  importPath: string
  variantIds: string[]
  route: string
  designFoundation: { galleryNodeId: string | null; galleryNodeStatus: string }
}

type Inventory = {
  derived: { familyCount: number; familyIds: string[]; itemCount: number; variantCount: number }
  items: InventoryItem[]
}

function readInventory(): Inventory {
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8')) as Inventory
}

async function loadRuntimeEntries() {
  const loaded = []
  for (const family of galleryFamilies) {
    const mod = await family.load()
    for (const entry of mod.entries) {
      loaded.push({
        familyId: family.id,
        entryId: entry.id,
        title: entry.title,
        importPath: entry.importPath,
        variantIds: entry.variants.map((variant) => variant.id),
        figmaNodeId: entry.figmaNodeId ?? null,
      })
    }
  }
  return loaded
}

test('the derived inventory covers exactly the families the registry loads, in order', () => {
  const inventory = readInventory()
  expect(inventory.derived.familyIds).toEqual(galleryFamilies.map((family) => family.id))
  expect(inventory.derived.familyCount).toBe(galleryFamilies.length)
})

test('every runtime gallery entry appears in the derived inventory with identical facts', async () => {
  const inventory = readInventory()
  const runtime = await loadRuntimeEntries()

  expect(inventory.items).toHaveLength(runtime.length)
  expect(inventory.derived.itemCount).toBe(runtime.length)

  const byId = new Map(inventory.items.map((item) => [item.galleryItemId, item]))
  for (const entry of runtime) {
    const id = `${entry.familyId}/${entry.entryId}`
    const item = byId.get(id)
    expect(item).toBeDefined()
    expect(item!.familyId).toBe(entry.familyId)
    expect(item!.entryId).toBe(entry.entryId)
    expect(item!.title).toBe(entry.title)
    expect(item!.importPath).toBe(entry.importPath)
    expect(item!.variantIds).toEqual(entry.variantIds)
    expect(item!.route).toBe(`/backend/design-system?family=${entry.familyId}&entry=${entry.entryId}`)
  }
})

test('the inventory invents no gallery item the registry does not load', async () => {
  const inventory = readInventory()
  const runtime = await loadRuntimeEntries()
  const runtimeIds = new Set(runtime.map((entry) => `${entry.familyId}/${entry.entryId}`))
  for (const item of inventory.items) {
    expect(runtimeIds.has(item.galleryItemId)).toBe(true)
  }
})

test('the derived variant total equals what the registry really renders', async () => {
  const inventory = readInventory()
  const runtime = await loadRuntimeEntries()
  const runtimeVariants = runtime.reduce((total, entry) => total + entry.variantIds.length, 0)
  expect(inventory.derived.variantCount).toBe(runtimeVariants)

  // A family that builds variants programmatically is the case a static reader is most likely to
  // under-report, so the per-entry counts are checked too rather than only the total.
  const byId = new Map(inventory.items.map((item) => [item.galleryItemId, item]))
  for (const entry of runtime) {
    const item = byId.get(`${entry.familyId}/${entry.entryId}`)!
    expect(item.variantIds).toHaveLength(entry.variantIds.length)
  }
})

test('gallery node ids are carried from the registry and normalized, never invented', async () => {
  const inventory = readInventory()
  const runtime = await loadRuntimeEntries()
  const byId = new Map(inventory.items.map((item) => [item.galleryItemId, item]))

  for (const entry of runtime) {
    const foundation = byId.get(`${entry.familyId}/${entry.entryId}`)!.designFoundation
    if (entry.figmaNodeId == null) {
      expect(foundation.galleryNodeStatus).toBe('absent')
      expect(foundation.galleryNodeId).toBeNull()
    } else {
      expect(foundation.galleryNodeStatus).toBe('known')
      expect(foundation.galleryNodeId).toBe(entry.figmaNodeId.replace(/-/g, ':'))
    }
  }
})
