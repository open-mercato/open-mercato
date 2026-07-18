import { galleryFamilies } from '../registry'
import type { GalleryEntry } from '../types'

const FIGMA_NODE_ID = /^\d+:\d+$/

async function loadAllEntries(): Promise<Array<{ familyId: string; entry: GalleryEntry }>> {
  const loadedFamilies = await Promise.all(
    galleryFamilies.map(async (family) => ({
      familyId: family.id,
      entries: (await family.load()).entries,
    })),
  )
  return loadedFamilies.flatMap(({ familyId, entries }) =>
    entries.map((entry) => ({ familyId, entry })),
  )
}

describe('design_system gallery registry integrity', () => {
  it('declares unique family ids', () => {
    const ids = galleryFamilies.map((family) => family.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps entry ids unique gallery-wide', async () => {
    const all = await loadAllEntries()
    const ids = all.map(({ entry }) => entry.id)
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    expect(duplicates).toEqual([])
  })

  it('keeps variant ids unique per entry', async () => {
    const all = await loadAllEntries()
    for (const { entry } of all) {
      const variantIds = entry.variants.map((variant) => variant.id)
      expect(new Set(variantIds).size).toBe(variantIds.length)
      expect(variantIds.length).toBeGreaterThan(0)
    }
  })

  it("includes the entry's importPath in every variant code snippet", async () => {
    const all = await loadAllEntries()
    for (const { entry } of all) {
      for (const variant of entry.variants) {
        expect(variant.code).toContain(entry.importPath)
      }
    }
  })

  it('uses <page>:<node> format for every figmaNodeId', async () => {
    const all = await loadAllEntries()
    for (const { entry } of all) {
      if (entry.figmaNodeId !== undefined) {
        expect(entry.figmaNodeId).toMatch(FIGMA_NODE_ID)
      }
    }
  })
})
