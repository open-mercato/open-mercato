/** @jest-environment node */
/**
 * Keeps `integrationTestPaths` from overstating what a capability row is proven by.
 *
 * The field name says "integration" but its documented contract is repository-only
 * EVIDENCE, and it legitimately holds both `__tests__/**` (unit) and `__integration__/**`
 * (Playwright). A reviewer — or an agent reading the inventory as truth — can easily read a
 * populated field as "this capability has an integration spec" when every entry is a unit
 * test. A verifier in this program made exactly that reading and called it a blocking
 * misrepresentation.
 *
 * The convention is fine; the ambiguity is not. These assertions make the two kinds
 * distinguishable mechanically, and make the surface map state which rows have real
 * integration coverage instead of leaving it to be inferred from a field name.
 */
import fs from 'node:fs'
import path from 'node:path'

type Capability = {
  capabilityId: string
  integrationTestPaths: string[]
}

const moduleRoot = path.join(__dirname, '..')
const inventory = JSON.parse(
  fs.readFileSync(path.join(moduleRoot, 'references', 'surface-inventory.json'), 'utf8'),
) as { generatedNote: string; capabilities: Capability[] }

const isIntegrationSpec = (entry: string) => entry.includes('/__integration__/')
const isUnitTest = (entry: string) => entry.includes('/__tests__/')

describe('surface inventory evidence honesty', () => {
  it('documents that a populated integrationTestPaths is not proof of an integration spec', () => {
    // If someone renames or reflows the note, this fails rather than letting the ambiguity
    // silently return.
    expect(inventory.generatedNote).toContain('has NO integration coverage')
    expect(inventory.generatedNote).toContain('not proof that an integration spec exists')
  })

  it('lists only real test files under integrationTestPaths, never source', () => {
    const offenders: string[] = []
    for (const capability of inventory.capabilities) {
      for (const entry of capability.integrationTestPaths ?? []) {
        if (!isIntegrationSpec(entry) && !isUnitTest(entry)) {
          offenders.push(`${capability.capabilityId} → ${entry}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('points every evidence entry at a file that exists', () => {
    const missing: string[] = []
    for (const capability of inventory.capabilities) {
      for (const entry of capability.integrationTestPaths ?? []) {
        // Inventory paths are app-root relative (`src/modules/example/...`).
        const absolute = path.join(moduleRoot, '..', '..', '..', entry)
        if (!fs.existsSync(absolute)) missing.push(`${capability.capabilityId} → ${entry}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('reports which capabilities have genuine integration coverage and which do not', () => {
    const withIntegration = inventory.capabilities.filter((capability) =>
      (capability.integrationTestPaths ?? []).some(isIntegrationSpec))
    const unitOnly = inventory.capabilities.filter((capability) => {
      const paths = capability.integrationTestPaths ?? []
      return paths.length > 0 && !paths.some(isIntegrationSpec)
    })

    // Not a threshold to game — the point is that both sets are non-empty and therefore
    // genuinely distinguishable, so nobody can claim the field means one single thing.
    expect(withIntegration.length).toBeGreaterThan(0)
    expect(unitOnly.length).toBeGreaterThan(0)
    expect(withIntegration.length + unitOnly.length).toBeLessThanOrEqual(inventory.capabilities.length)
  })
})
