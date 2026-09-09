import { collectModuleOverrideTargets } from '../module-override-targets'
import {
  FIXTURE_MODULE_ID,
  FIXTURE_SOURCE_ROOT,
  OVERRIDE_TARGET_DIAGNOSTIC_FIXTURES,
  catalogWith,
  catalogWithout,
  collectWithCatalogOperations,
  fixtureFacts,
  realCatalogOperations,
} from './helpers/override-target-diagnostic-fixtures'

function codesFor(
  diagnostics: { code: string; domain: string }[],
  domain: string,
): string[] {
  return diagnostics.filter((diagnostic) => diagnostic.domain === domain).map((diagnostic) => diagnostic.code)
}

describe('override-target diagnostic wiring — the published code names the real cause', () => {
  it('publishes unknown-framework-mode when the catalog describes the host with an unusable operation', () => {
    const { overrideTargets, overrideTargetDiagnostics } = collectWithCatalogOperations(
      catalogWith('cli', 'merge-deep'),
      fixtureFacts(),
    )
    const cliDiagnostics = overrideTargetDiagnostics.filter((diagnostic) => diagnostic.domain === 'cli')
    expect(cliDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unknown-framework-mode'])
    expect(cliDiagnostics[0]).toEqual({
      code: 'unknown-framework-mode',
      moduleId: FIXTURE_MODULE_ID,
      domain: 'cli',
      candidatePath: ['cli', 'fixture:seed'],
      source: { sourcePath: `${FIXTURE_SOURCE_ROOT}/cli.ts` },
    })
    expect(overrideTargets.some((target) => target.domain === 'cli')).toBe(false)
  })

  it('publishes unknown-framework-domain when the catalog does not describe the host at all', () => {
    const { overrideTargets, overrideTargetDiagnostics } = collectWithCatalogOperations(
      catalogWithout('cli'),
      fixtureFacts(),
    )
    expect(codesFor(overrideTargetDiagnostics, 'cli')).toEqual(['unknown-framework-domain'])
    expect(overrideTargets.some((target) => target.domain === 'cli')).toBe(false)
  })

  it('never collapses the two causes: one run emits a distinct code per failing domain', () => {
    const operations = catalogWithout('cli')
    operations.workers = 'merge-deep'
    const { overrideTargetDiagnostics } = collectWithCatalogOperations(
      operations,
      fixtureFacts({
        ownedContracts: {
          worker: [
            {
              kind: 'worker',
              id: 'fixture.worker',
              source: { sourcePath: `${FIXTURE_SOURCE_ROOT}/workers/fixture.ts`, line: 1 },
            },
          ],
        },
      }),
    )
    expect(codesFor(overrideTargetDiagnostics, 'cli')).toEqual(['unknown-framework-domain'])
    expect(codesFor(overrideTargetDiagnostics, 'workers')).toEqual(['unknown-framework-mode'])
    expect(new Set(overrideTargetDiagnostics.map((diagnostic) => diagnostic.code)).size).toBe(2)
  })

  it('emits the target and no diagnostic when the real catalog describes the host', () => {
    const stubbed = collectWithCatalogOperations(realCatalogOperations(), fixtureFacts())
    const direct = collectModuleOverrideTargets(fixtureFacts())
    expect(stubbed).toEqual(direct)
    expect(direct.overrideTargetDiagnostics).toEqual([])
    expect(direct.overrideTargets.map((target) => target.path)).toEqual([['cli', 'fixture:seed']])
    expect(direct.overrideTargets[0].modes).toEqual(['disable-replace'])
  })
})

describe('every negative-fixture diagnostic code is produced by a real fixture', () => {
  it.each(OVERRIDE_TARGET_DIAGNOSTIC_FIXTURES.map((fixture) => [fixture.code, fixture] as const))(
    '%s',
    (code, fixture) => {
      const diagnostics = fixture.run()
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(code)
    },
  )

  it('covers each code with exactly one fixture', () => {
    const codes = OVERRIDE_TARGET_DIAGNOSTIC_FIXTURES.map((fixture) => fixture.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
