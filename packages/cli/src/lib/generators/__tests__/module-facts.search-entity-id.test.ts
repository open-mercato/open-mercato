import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractModuleFacts } from '../module-facts'

/**
 * A search entity declared with a non-literal `entityId` must still reach module facts.
 *
 * `extractSearchEntities` accepted only a bare string literal, but modules reference the
 * entity through `E.<module>.<entity>` (the generated entity-id registry, where
 * `E[module][entity] === '<module>:<entity>'`) or through a same-file `const ENTITY_ID`.
 * Every such entry was dropped with NO diagnostic, so a module shipping `search.ts` scored
 * zero search facts while looking healthy — the same class of defect as the computed DI
 * token. Repo-wide this moved the search family from 47 ids across 9 modules to 52 across 11.
 *
 * The second half of this file pins the other direction: an `entityId` the reader genuinely
 * cannot know statically (an imported constant object) must NOT be guessed, and must produce
 * a warning rather than a silent zero.
 */

type Probe = {
  searchEntities: string[]
  warnings: string[]
  searchRegistryIds: string[]
}

function probe(searchSource: string): Probe {
  const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-search-entity-id-'))
  try {
    fs.writeFileSync(path.join(moduleRoot, 'search.ts'), searchSource)
    const facts = extractModuleFacts({
      moduleId: 'probe',
      moduleRoot,
      sourceRoot: 'src/modules/probe',
    }) as unknown as {
      searchEntities: string[]
      warnings: string[]
      extensionSurfaces?: {
        contributions?: Array<{ kind: string; details?: { registry?: string; registryId?: string } }>
      }
    }
    return {
      searchEntities: facts.searchEntities,
      warnings: facts.warnings.filter((warning) => warning.includes('searchConfig')),
      searchRegistryIds: (facts.extensionSurfaces?.contributions ?? [])
        .filter((contribution) => contribution.details?.registry === 'search')
        .map((contribution) => contribution.details?.registryId ?? ''),
    }
  } finally {
    fs.rmSync(moduleRoot, { recursive: true, force: true })
  }
}

describe('module-facts search entityId resolution', () => {
  it('resolves an entityId declared as a same-file const', () => {
    const result = probe(`
      const ENTITY_ID = 'probe:todo' as const
      export const searchConfig = {
        entities: [{ entityId: ENTITY_ID, enabled: true }],
      }
    `)

    expect(result.searchEntities).toEqual(['probe:todo'])
    expect(result.warnings).toEqual([])
    // The whole chain matters: `searchEntities` feeds the specialized-registry contribution
    // that downstream consumers actually read.
    expect(result.searchRegistryIds).toEqual(['probe:todo'])
  })

  it('resolves an entityId read from the generated entity-id registry', () => {
    const result = probe(`
      import { E } from '#generated/entities.ids.generated'
      export const searchConfig = {
        entities: [
          { entityId: E.probe.todo, enabled: true },
          { entityId: E['probe']['note'], enabled: true },
        ],
      }
    `)

    expect(result.searchEntities).toEqual(['probe:todo', 'probe:note'])
    expect(result.warnings).toEqual([])
  })

  it('still resolves a plain string literal and de-duplicates repeats', () => {
    const result = probe(`
      export const searchConfig = {
        entities: [
          { entityId: 'probe:todo' },
          { entityId: 'probe:todo' },
          { entityId: 'probe:note' },
        ],
      }
    `)

    expect(result.searchEntities).toEqual(['probe:todo', 'probe:note'])
    expect(result.warnings).toEqual([])
  })

  it('reports rather than invents an entityId it cannot resolve statically', () => {
    // `CHECKOUT_ENTITY_IDS` lives in another file, so a single-file reader cannot know the
    // value. Emitting a guessed id would be worse than emitting none — but staying silent is
    // what let this family read zero for years, so the entry must surface as a warning.
    const result = probe(`
      import { CHECKOUT_ENTITY_IDS } from './lib/constants'
      import { CONSTANTS } from './lib/other'
      export const searchConfig = {
        entities: [
          { entityId: CHECKOUT_ENTITY_IDS.link, enabled: true },
          { entityId: CONSTANTS.entities.todo, enabled: true },
          { entityId: 'probe:known' },
        ],
      }
    `)

    // Neither the two-segment access nor the three-segment access rooted at something other
    // than the generated `E` registry may be folded into an id.
    expect(result.searchEntities).toEqual(['probe:known'])
    expect(result.searchRegistryIds).toEqual(['probe:known'])
    expect(result.warnings).toHaveLength(2)
    for (const warning of result.warnings) {
      expect(warning).toContain('searchConfig entityId is not statically resolvable')
    }
  })

  it('reports an entity that declares no entityId at all', () => {
    const result = probe(`
      export const searchConfig = {
        entities: [{ enabled: true, priority: 5 }],
      }
    `)

    expect(result.searchEntities).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('searchConfig entity declares no entityId')
  })

  it('does not follow a self-referential const into an infinite loop', () => {
    const result = probe(`
      const A = B
      const B = A
      export const searchConfig = {
        entities: [{ entityId: A }],
      }
    `)

    expect(result.searchEntities).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('searchConfig entityId is not statically resolvable')
  })
})
