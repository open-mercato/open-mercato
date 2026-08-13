import type { ModuleFactsJsonEntry } from '../../module-facts'
import { getFrameworkOverrideHostOperations } from '../../module-extension-facts'
import {
  collectModuleOverrideTargets,
  type ModuleOverrideTargetDiagnostic,
  type ModuleOverrideTargetDiagnosticCode,
  type ModuleOverrideTargetsResult,
} from '../../module-override-targets'

/**
 * Real producers for every override-target diagnostic the projector can emit.
 *
 * The `factCoverage` ledger classifies four diagnostic codes as `negative-fixture`,
 * which is a claim that a fixture really drives that code out of
 * {@link collectModuleOverrideTargets}. These fixtures ARE that claim's evidence, and
 * the coverage test asserts the produced set matches the ledger rows exactly — so a
 * row can never name a fixture that does not exist, and a code no fixture reaches
 * cannot be published as `negative-fixture`.
 */

export const FIXTURE_MODULE_ID = 'fixture'
export const FIXTURE_SOURCE_ROOT = `node_modules/@open-mercato/core/src/modules/${FIXTURE_MODULE_ID}`

export function fixtureFacts(overrides: Partial<ModuleFactsJsonEntry> = {}): ModuleFactsJsonEntry {
  return {
    title: 'Fixture',
    description: null,
    coreVersion: null,
    sourcePackage: '@open-mercato/core',
    sourceVersion: null,
    sourceRoot: FIXTURE_SOURCE_ROOT,
    entities: [],
    events: [],
    aclFeatures: [],
    apiRoutes: [],
    diTokens: [],
    searchEntities: [],
    hostTokens: { entityIds: [], tableIds: [] },
    notifications: [],
    cli: ['fixture:seed'],
    backendPages: [],
    frontendPages: [],
    cliCommands: [{ command: 'fixture:seed', sourcePath: `${FIXTURE_SOURCE_ROOT}/cli.ts` }],
    aiTools: [],
    aiAgents: [],
    ...overrides,
  }
}

function fixtureWorkerFacts(): ModuleFactsJsonEntry {
  return fixtureFacts({
    ownedContracts: {
      worker: [
        {
          kind: 'worker',
          id: 'fixture.worker',
          source: { sourcePath: `${FIXTURE_SOURCE_ROOT}/workers/fixture.ts`, line: 1 },
        },
      ],
    },
  })
}

/**
 * The framework catalog's real declared operations, which the projector reads at
 * import time. Tests derive their stub catalogs from this so a stub differs from
 * production in exactly the one host under test.
 */
export function realCatalogOperations(): Record<string, string> {
  return getFrameworkOverrideHostOperations()
}

export function catalogWithout(dottedHost: string): Record<string, string> {
  const operations = realCatalogOperations()
  delete operations[dottedHost]
  return operations
}

export function catalogWith(dottedHost: string, operation: string): Record<string, string> {
  return { ...realCatalogOperations(), [dottedHost]: operation }
}

/**
 * Re-imports the projector against a stubbed framework catalog, so the two "no
 * modes" causes reach the real `pushTarget` wiring instead of only the pure
 * resolver. Every catalog host ships a valid operation today, so a stub is the only
 * way to drive the unknown-domain/unknown-mode branches through production code.
 */
export function collectWithCatalogOperations(
  hostOperations: Record<string, string>,
  facts: ModuleFactsJsonEntry,
): ModuleOverrideTargetsResult {
  let result: ModuleOverrideTargetsResult | undefined
  jest.isolateModules(() => {
    jest.doMock('../../module-extension-facts', () => ({
      ...jest.requireActual('../../module-extension-facts'),
      getFrameworkOverrideHostOperations: () => hostOperations,
    }))
    const projector = require('../../module-override-targets') as typeof import('../../module-override-targets')
    result = projector.collectModuleOverrideTargets(facts)
  })
  jest.dontMock('../../module-extension-facts')
  if (!result) throw new Error('[internal] isolated override-target collection produced no result')
  return result
}

export type OverrideTargetDiagnosticFixture = {
  code: ModuleOverrideTargetDiagnosticCode
  description: string
  run: () => ModuleOverrideTargetDiagnostic[]
}

export const OVERRIDE_TARGET_DIAGNOSTIC_FIXTURES: OverrideTargetDiagnosticFixture[] = [
  {
    code: 'missing-source',
    description: 'a cli command whose provenance cannot be proven',
    run: () =>
      collectModuleOverrideTargets(fixtureFacts({ cliCommands: [{ command: 'fixture:seed', sourcePath: null }] }))
        .overrideTargetDiagnostics,
  },
  {
    code: 'unsupported-dynamic-key',
    description: 'an api route whose method the runtime cannot address',
    run: () =>
      collectModuleOverrideTargets(
        fixtureFacts({
          apiRoutes: [
            {
              path: '/fixture/items',
              methods: ['FETCH'],
              auth: {},
              sourcePath: `${FIXTURE_SOURCE_ROOT}/api/items/route.ts`,
            },
          ],
        }),
      ).overrideTargetDiagnostics,
  },
  {
    code: 'unknown-framework-domain',
    description: 'the framework catalog does not describe the cli host at all',
    run: () => collectWithCatalogOperations(catalogWithout('cli'), fixtureFacts()).overrideTargetDiagnostics,
  },
  {
    code: 'unknown-framework-mode',
    description: 'the framework catalog describes the workers host with an operation that is not a public mode',
    run: () =>
      collectWithCatalogOperations(catalogWith('workers', 'merge-deep'), fixtureWorkerFacts())
        .overrideTargetDiagnostics,
  },
]
