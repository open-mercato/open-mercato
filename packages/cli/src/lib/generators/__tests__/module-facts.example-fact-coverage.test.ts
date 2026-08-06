import fs from 'node:fs'
import path from 'node:path'
import {
  MODULE_FACT_SOURCE_KINDS,
  MODULE_OWNED_CONTRACT_KINDS,
  buildCoverageFamily,
  buildModuleFactCoverageLedger,
  countModuleFactCoverage,
  extractAllModuleFacts,
  extractModuleFacts,
  type ModuleFactCoverageFamily,
  type ModuleFactCoverageRow,
  type ModuleFacts,
} from '../module-facts'
import {
  ALL_OVERRIDE_DOMAINS,
  MODULE_OVERRIDE_MODES,
  MODULE_OVERRIDE_TARGET_DIAGNOSTIC_CODES,
  MODULE_OVERRIDE_TARGET_NOTES,
} from '../module-override-targets'
import { OVERRIDE_TARGET_DIAGNOSTIC_FIXTURES } from './helpers/override-target-diagnostic-fixtures'

function findRepoRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    if (fs.existsSync(path.join(dir, 'packages', 'core', 'src', 'modules'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate repo root from the test directory')
}

const CLOSED_LEDGER_STATUSES = [
  'emitted-example',
  'framework-only',
  'catalog-only',
  'currently-unbound',
  'pending-emission',
  'negative-fixture',
] as const

/**
 * A route the example module really ships, addressed the way the generated module
 * registry addresses it. `api-route` facts are read from that registry rather than
 * from module source, so this fixture is what turns the `requiresGeneratedRegistry`
 * flag from an unchecked claim into a proven one: the same extraction reports zero
 * without it and a real count with it.
 */
const REGISTRY_BACKED_ROUTE = {
  path: '/example/todos',
  sourceFile: 'apps/mercato/src/modules/example/api/todos/route.ts',
}

function exampleRegistrySource(): string {
  return [
    'export const modules = [',
    "  { id: 'example', apis: [",
    `    { path: '${REGISTRY_BACKED_ROUTE.path}', handlers: { GET: getTodos, POST: createTodo } },`,
    '  ] },',
    ']',
  ].join('\n')
}

function extractExampleFacts(registrySource?: string): ModuleFacts {
  return extractModuleFacts({
    moduleId: 'example',
    moduleRoot: path.join(findRepoRoot(), 'apps', 'mercato', 'src', 'modules', 'example'),
    portableSourceRoot: 'src/modules/example',
    ...(registrySource === undefined ? {} : { registrySource }),
  })
}

function familyOf(ledger: ModuleFactCoverageFamily[], name: string): ModuleFactCoverageFamily {
  const family = ledger.find((entry) => entry.family === name)
  if (!family) throw new Error(`[internal] factCoverage ledger has no family "${name}"`)
  return family
}

describe('factCoverage ledger — enum derivation', () => {
  const ledger = buildModuleFactCoverageLedger()

  it('classifies every value of every enumerated family exactly once', () => {
    const expectedSizes: Record<string, number> = {
      ModuleFactSourceKind: MODULE_FACT_SOURCE_KINDS.length,
      ModuleOwnedContractKind: MODULE_OWNED_CONTRACT_KINDS.length,
      ModuleOverrideDomain: ALL_OVERRIDE_DOMAINS.length,
      ModuleOverrideMode: MODULE_OVERRIDE_MODES.length,
      ModuleOverrideTargetNote: MODULE_OVERRIDE_TARGET_NOTES.length,
      ModuleOverrideTargetDiagnosticCode: MODULE_OVERRIDE_TARGET_DIAGNOSTIC_CODES.length,
    }
    expect(ledger.map((family) => family.family).sort()).toEqual(Object.keys(expectedSizes).sort())
    for (const family of ledger) {
      expect(family.rows).toHaveLength(expectedSizes[family.family])
      const values = family.rows.map((row) => row.value)
      expect(new Set(values).size).toBe(values.length)
      expect(family.enumSource).toMatch(/^packages\/cli\/src\/lib\/generators\/.+#[A-Z_]+$/)
    }
  })

  it('resolves every enumSource to a file that really exports that symbol with those values', () => {
    for (const family of ledger) {
      const [relativePath, symbol] = family.enumSource.split('#')
      const absolute = path.join(findRepoRoot(), relativePath)
      expect(fs.existsSync(absolute)).toBe(true)
      expect(fs.readFileSync(absolute, 'utf8')).toMatch(new RegExp(`^export const ${symbol}\\b`, 'm'))
      const exported = (require(absolute) as Record<string, unknown>)[symbol]
      expect(Array.isArray(exported)).toBe(true)
      expect([...(exported as string[])]).toEqual(family.rows.map((row) => row.value))
    }
  })

  it('derives each family from the exported runtime constant, value for value', () => {
    expect(familyOf(ledger, 'ModuleFactSourceKind').rows.map((row) => row.value)).toEqual([
      ...MODULE_FACT_SOURCE_KINDS,
    ])
    expect(familyOf(ledger, 'ModuleOwnedContractKind').rows.map((row) => row.value)).toEqual([
      ...MODULE_OWNED_CONTRACT_KINDS,
    ])
    expect(familyOf(ledger, 'ModuleOverrideDomain').rows.map((row) => row.value)).toEqual([...ALL_OVERRIDE_DOMAINS])
    expect(familyOf(ledger, 'ModuleOverrideMode').rows.map((row) => row.value)).toEqual([...MODULE_OVERRIDE_MODES])
    expect(familyOf(ledger, 'ModuleOverrideTargetNote').rows.map((row) => row.value)).toEqual([
      ...MODULE_OVERRIDE_TARGET_NOTES,
    ])
    expect(familyOf(ledger, 'ModuleOverrideTargetDiagnosticCode').rows.map((row) => row.value)).toEqual([
      ...MODULE_OVERRIDE_TARGET_DIAGNOSTIC_CODES,
    ])
  })

  it('locks the ten ModuleOwnedContractKind values the spec enumerates', () => {
    expect([...MODULE_OWNED_CONTRACT_KINDS]).toEqual([
      'module-metadata',
      'command',
      'worker',
      'page-middleware',
      'setup',
      'encryption',
      'di-registration',
      'custom-entity',
      'ai-extension',
      'generator-plugin',
    ])
    expect(familyOf(ledger, 'ModuleOwnedContractKind').rows).toHaveLength(10)
  })

  it('uses only the six closed statuses and keeps status self-sufficient', () => {
    const allowed = new Set<string>(CLOSED_LEDGER_STATUSES)
    for (const family of ledger) {
      for (const row of family.rows) {
        expect(allowed.has(row.status)).toBe(true)
        expect(row.note.length).toBeGreaterThan(0)
        // A reader keying on `status` alone must never be told the example emits
        // something it does not: the pending gap lives in the status itself.
        if (row.pendingEmission) expect(row.status).toBe('pending-emission')
        if (row.status === 'pending-emission') expect(row.pendingEmission?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })
})

describe('buildCoverageFamily — both directions of the enum/ledger contract', () => {
  const row = (value: string): ModuleFactCoverageRow => ({ value, status: 'emitted-example', note: 'fixture' })

  it('classifies every enumerated value when the ledger is complete', () => {
    const family = buildCoverageFamily('Fixture', 'packages/cli/src/lib/generators/module-facts.ts#FIXTURE', ['a', 'b'], {
      a: row('a'),
      b: row('b'),
    })
    expect(family.rows.map((entry) => entry.value)).toEqual(['a', 'b'])
  })

  it('throws when an enumerated value has no row', () => {
    expect(() =>
      buildCoverageFamily('Fixture', 'packages/cli/src/lib/generators/module-facts.ts#FIXTURE', ['a', 'b'], {
        a: row('a'),
      }),
    ).toThrow(/has no row for: b/)
  })

  it('throws on a stale row for a value the enum no longer carries', () => {
    expect(() =>
      buildCoverageFamily('Fixture', 'packages/cli/src/lib/generators/module-facts.ts#FIXTURE', ['a'], {
        a: row('a'),
        removed: row('removed'),
      }),
    ).toThrow(/classifies values absent from the enum: removed/)
  })
})

describe('factCoverage ledger — built by fact generation, not only by this test', () => {
  it('is built and returned on every extractAllModuleFacts run', () => {
    const generated = extractAllModuleFacts({ sources: [] })
    expect(generated.factCoverage).toEqual(buildModuleFactCoverageLedger())
  })
})

describe('factCoverage ledger — checked against the real example extraction', () => {
  const ledger = buildModuleFactCoverageLedger()
  const facts = extractExampleFacts()
  const counts = countModuleFactCoverage(facts)

  it('extracts the real canonical example module', () => {
    expect(facts.module).toBe('example')
    expect(facts.sourceRoot).toBe('src/modules/example')
  })

  it('proves a non-zero real count for every emitted-example row', () => {
    const unproven: string[] = []
    let proven = 0
    for (const family of ledger) {
      const familyCounts = counts[family.family] ?? {}
      for (const row of family.rows) {
        if (row.status !== 'emitted-example') continue
        if (row.requiresGeneratedRegistry) continue
        const count = familyCounts[row.value] ?? 0
        if (count <= 0) unproven.push(`${family.family}.${row.value}`)
        else proven += 1
      }
    }
    expect(unproven).toEqual([])
    expect(proven).toBeGreaterThan(0)
  })

  it('keeps every pending-emission row at a real count of zero so it cannot go stale', () => {
    const wronglyPending: string[] = []
    const pending: string[] = []
    for (const family of ledger) {
      const familyCounts = counts[family.family] ?? {}
      for (const row of family.rows) {
        if (row.status !== 'pending-emission') continue
        pending.push(`${family.family}.${row.value}`)
        if ((familyCounts[row.value] ?? 0) > 0) wronglyPending.push(`${family.family}.${row.value}`)
      }
    }
    expect(wronglyPending).toEqual([])
    expect(pending).toEqual([
      'ModuleFactSourceKind.vector',
      'ModuleFactSourceKind.generator-plugin',
      'ModuleOwnedContractKind.generator-plugin',
    ])
  })

  it('keeps every catalog-only row at a real count of zero, since the example contributes nothing for it', () => {
    const contributing: string[] = []
    for (const family of ledger) {
      const familyCounts = counts[family.family] ?? {}
      for (const row of family.rows) {
        if (row.status !== 'catalog-only') continue
        if ((familyCounts[row.value] ?? 0) > 0) contributing.push(`${family.family}.${row.value}`)
      }
    }
    expect(contributing).toEqual([])
  })

  it('publishes nine of the ten owned-contract kinds today, generator-plugin being the open gap', () => {
    const ownedCounts = counts.ModuleOwnedContractKind
    for (const kind of MODULE_OWNED_CONTRACT_KINDS) {
      if (kind === 'generator-plugin') {
        expect(ownedCounts[kind] ?? 0).toBe(0)
        continue
      }
      expect(ownedCounts[kind] ?? 0).toBeGreaterThan(0)
    }
    expect(fs.existsSync(path.join(findRepoRoot(), 'apps/mercato/src/modules/example/generators.ts'))).toBe(false)
  })

  it('emits a real override target for all fifteen module-owned domains and none for framework-only nav', () => {
    const domainCounts = counts.ModuleOverrideDomain
    for (const domain of ALL_OVERRIDE_DOMAINS) {
      if (domain === 'nav') {
        expect(domainCounts[domain] ?? 0).toBe(0)
        continue
      }
      expect(domainCounts[domain] ?? 0).toBeGreaterThan(0)
    }
    expect(Object.keys(domainCounts)).toHaveLength(ALL_OVERRIDE_DOMAINS.length - 1)
  })

  it('round-trips all three modes and both closed notes through real targets', () => {
    for (const mode of MODULE_OVERRIDE_MODES) {
      expect(counts.ModuleOverrideMode[mode] ?? 0).toBeGreaterThan(0)
    }
    for (const note of MODULE_OVERRIDE_TARGET_NOTES) {
      expect(counts.ModuleOverrideTargetNote[note] ?? 0).toBeGreaterThan(0)
    }
  })

  it('emits zero override-target diagnostics from activated canonical output', () => {
    expect(facts.overrideTargetDiagnostics ?? []).toEqual([])
    for (const code of MODULE_OVERRIDE_TARGET_DIAGNOSTIC_CODES) {
      expect(counts.ModuleOverrideTargetDiagnosticCode[code] ?? 0).toBe(0)
    }
  })

  it('never classifies a diagnostic code as canonical coverage', () => {
    for (const row of familyOf(ledger, 'ModuleOverrideTargetDiagnosticCode').rows) {
      expect(['negative-fixture', 'currently-unbound']).toContain(row.status)
    }
  })

  it('backs every negative-fixture claim with a fixture that really produces that code', () => {
    const claimed = familyOf(ledger, 'ModuleOverrideTargetDiagnosticCode')
      .rows.filter((row) => row.status === 'negative-fixture')
      .map((row) => row.value)
      .sort()
    const produced = OVERRIDE_TARGET_DIAGNOSTIC_FIXTURES.flatMap((fixture) =>
      fixture.run().map((diagnostic) => diagnostic.code),
    )
    expect([...new Set(produced)].sort()).toEqual(claimed)
  })

  it('classifies a code no fixture can reach as currently-unbound, not as a negative fixture', () => {
    const unbound = familyOf(ledger, 'ModuleOverrideTargetDiagnosticCode')
      .rows.filter((row) => row.status === 'currently-unbound')
      .map((row) => row.value)
    expect(unbound).toEqual(['missing-owned-fact'])
    const produced = new Set(
      OVERRIDE_TARGET_DIAGNOSTIC_FIXTURES.flatMap((fixture) => fixture.run().map((diagnostic) => diagnostic.code)),
    )
    for (const code of unbound) expect(produced.has(code)).toBe(false)
    const projectorSource = fs.readFileSync(
      path.join(findRepoRoot(), 'packages/cli/src/lib/generators/module-override-targets.ts'),
      'utf8',
    )
    // Reserved by the closed set, but no adapter names it as a `code:` value today.
    expect(projectorSource).not.toMatch(/code: 'missing-owned-fact'/)
  })
})

/**
 * `requiresGeneratedRegistry` is the only way a row can skip the non-zero proof, so
 * the flag itself is proven here rather than trusted: a row carrying it must report
 * zero from a source-only extraction (otherwise the row is extractable from source
 * and the skip is unwarranted) AND a real count once the same extraction is handed a
 * module registry (otherwise nothing emits it at all and the row is not
 * `emitted-example`). Setting the flag on a row that fails either side fails here.
 */
describe('requiresGeneratedRegistry — the only skip out of the non-zero proof is itself proven', () => {
  const ledger = buildModuleFactCoverageLedger()
  const sourceOnlyCounts = countModuleFactCoverage(extractExampleFacts())
  const registryBackedCounts = countModuleFactCoverage(extractExampleFacts(exampleRegistrySource()))
  const claims = ledger.flatMap((family) =>
    family.rows
      .filter((row) => row.requiresGeneratedRegistry)
      .map((row) => ({ family: family.family, row })),
  )
  const label = (claim: { family: string; row: ModuleFactCoverageRow }): string =>
    `${claim.family}.${claim.row.value}`

  it('is claimed by exactly the rows the rest of this suite proves', () => {
    expect(claims.map(label)).toEqual(['ModuleFactSourceKind.api-route'])
  })

  it('is claimed only where it changes anything: on an emitted-example row', () => {
    for (const claim of claims) expect(claim.row.status).toBe('emitted-example')
  })

  it('is claimed only by a value a source-only extraction genuinely cannot see', () => {
    const visibleFromSource = claims
      .filter((claim) => (sourceOnlyCounts[claim.family]?.[claim.row.value] ?? 0) > 0)
      .map(label)
    expect(visibleFromSource).toEqual([])
  })

  it('is claimed only by a value the generated registry really does yield', () => {
    const stillZeroWithRegistry = claims
      .filter((claim) => (registryBackedCounts[claim.family]?.[claim.row.value] ?? 0) <= 0)
      .map(label)
    expect(stillZeroWithRegistry).toEqual([])
  })

  it('drives the registry-backed count from a route the example module really ships', () => {
    expect(fs.existsSync(path.join(findRepoRoot(), REGISTRY_BACKED_ROUTE.sourceFile))).toBe(true)
    expect(registryBackedCounts.ModuleFactSourceKind['api-route']).toBe(1)
    expect(sourceOnlyCounts.ModuleFactSourceKind['api-route'] ?? 0).toBe(0)
  })
})

describe('factCoverage published into the example surface inventories', () => {
  const ledger = buildModuleFactCoverageLedger()
  const inventoryPaths = [
    'apps/mercato/src/modules/example/references/surface-inventory.json',
    'packages/create-app/template/src/modules/example/references/surface-inventory.json',
  ]

  function readInventory(relativePath: string): {
    factCoverage?: { generatedNote?: string; families?: ModuleFactCoverageFamily[] }
  } {
    return JSON.parse(fs.readFileSync(path.join(findRepoRoot(), relativePath), 'utf8'))
  }

  it.each(inventoryPaths)('%s publishes the ledger verbatim', (relativePath) => {
    const inventory = readInventory(relativePath)
    expect(inventory.factCoverage?.families).toEqual(ledger)
  })

  it.each(inventoryPaths)('%s warns that a ledger status is not proof on its own', (relativePath) => {
    const note = readInventory(relativePath).factCoverage?.generatedNote ?? ''
    expect(note).toContain('STATUS IS NOT PROOF ON ITS OWN')
    expect(note).toContain('pendingEmission')
    expect(note).toContain('requiresGeneratedRegistry')
  })

  it.each(inventoryPaths)('%s documents every status the closed set can publish', (relativePath) => {
    const note = readInventory(relativePath).factCoverage?.generatedNote ?? ''
    const undocumented = CLOSED_LEDGER_STATUSES.filter((status) => !note.includes(`\`${status}\``))
    expect(undocumented).toEqual([])
  })

  it('keeps the app inventory and the create-app template mirror byte-identical', () => {
    const [appInventory, templateInventory] = inventoryPaths.map((relativePath) =>
      fs.readFileSync(path.join(findRepoRoot(), relativePath), 'utf8'),
    )
    expect(templateInventory).toBe(appInventory)
  })
})
