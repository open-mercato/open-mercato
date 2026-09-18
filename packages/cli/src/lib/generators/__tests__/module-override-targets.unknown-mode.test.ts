import type { ModuleExtensionHostFact } from '@open-mercato/shared/modules/widgets/extension-points'
import { getFrameworkOverrideHostOperations, getFrameworkOverrideModes } from '../module-extension-facts'
import {
  MODULE_OVERRIDE_MODES,
  MODULE_OVERRIDE_TARGET_DIAGNOSTIC_CODES,
  resolveFrameworkOverrideModes,
} from '../module-override-targets'

/**
 * A catalog host declaring an operation this generator does not know. Every real
 * catalog host declares a valid mode today, so a stub is the only way to observe
 * what the raw operation map does with one — which is the whole point of the map
 * existing beside the validated mode map.
 */
const CATALOG_HOST_WITH_UNRECOGNIZED_OPERATION: ModuleExtensionHostFact = {
  key: 'framework.module-override.fixture.aheadOfGenerator',
  id: 'module-override:fixture.aheadOfGenerator',
  resolution: 'framework',
  family: 'module-override',
  ownerModule: 'framework',
  capabilities: ['module-override'],
  operations: ['merge-deep'],
  bound: true,
  stability: 'stable',
  source: {
    kind: 'framework',
    path: 'packages/shared/src/modules/overrides.ts',
    symbol: 'ModuleOverrides.fixture.aheadOfGenerator',
  },
}

describe('unknown-framework-mode override-target diagnostic', () => {
  it('is part of the closed diagnostic-code set', () => {
    expect([...MODULE_OVERRIDE_TARGET_DIAGNOSTIC_CODES]).toEqual([
      'missing-owned-fact',
      'missing-source',
      'unsupported-dynamic-key',
      'unknown-framework-domain',
      'unknown-framework-mode',
    ])
  })

  it('distinguishes an absent catalog host from a host whose declared mode is unrecognized', () => {
    expect(resolveFrameworkOverrideModes(undefined)).toEqual({ outcome: 'unknown-framework-domain' })
    expect(resolveFrameworkOverrideModes('merge-deep')).toEqual({
      outcome: 'unknown-framework-mode',
      operation: 'merge-deep',
    })
  })

  it('resolves every public mode and nothing else', () => {
    for (const mode of MODULE_OVERRIDE_MODES) {
      expect(resolveFrameworkOverrideModes(mode)).toEqual({ outcome: 'resolved', modes: [mode] })
    }
    expect(resolveFrameworkOverrideModes('')).toEqual({ outcome: 'unknown-framework-mode', operation: '' })
    expect(resolveFrameworkOverrideModes('DISABLE-REPLACE')).toEqual({
      outcome: 'unknown-framework-mode',
      operation: 'DISABLE-REPLACE',
    })
  })

  it('never guesses a target: an unrecognized mode yields no modes at all', () => {
    const resolution = resolveFrameworkOverrideModes('replace-all')
    expect(resolution.outcome).toBe('unknown-framework-mode')
    expect('modes' in resolution).toBe(false)
  })
})

describe('framework override host operations', () => {
  const operations = getFrameworkOverrideHostOperations()

  it('exposes the raw declared operation for every catalog host, unfiltered', () => {
    expect(Object.keys(operations).length).toBeGreaterThan(0)
    expect(operations['routes.api']).toBe('disable-replace')
    expect(operations['setup']).toBe('replace')
    expect(operations['ai.extensions']).toBe('additive')
    expect(operations['nav.groupOrder']).toBe('additive')
    expect(operations['no.such.host']).toBeUndefined()
  })

  it('keeps the validated mode map a strict subset of the raw operations', () => {
    const modes = getFrameworkOverrideModes()
    for (const [host, mode] of Object.entries(modes)) {
      expect(operations[host]).toBe(mode)
      expect(MODULE_OVERRIDE_MODES).toContain(mode)
    }
    for (const [host, operation] of Object.entries(operations)) {
      const resolution = resolveFrameworkOverrideModes(operation)
      expect(resolution.outcome === 'resolved').toBe(host in modes)
    }
  })
})

describe('a catalog operation the generator does not recognize', () => {
  const hosts = [CATALOG_HOST_WITH_UNRECOGNIZED_OPERATION]
  const dottedHost = 'fixture.aheadOfGenerator'

  it('survives the raw operation map unfiltered', () => {
    expect(getFrameworkOverrideHostOperations(hosts)).toEqual({ [dottedHost]: 'merge-deep' })
  })

  it('is dropped from the validated mode map, which is exactly why the raw map must not filter', () => {
    expect(getFrameworkOverrideModes(hosts)).toEqual({})
  })

  it('reads as a catalog this generator has fallen behind, never as a host that does not exist', () => {
    const rawOperations = getFrameworkOverrideHostOperations(hosts)
    const filteredOperations = getFrameworkOverrideModes(hosts)
    expect(resolveFrameworkOverrideModes(rawOperations[dottedHost])).toEqual({
      outcome: 'unknown-framework-mode',
      operation: 'merge-deep',
    })
    expect(resolveFrameworkOverrideModes(filteredOperations[dottedHost])).toEqual({
      outcome: 'unknown-framework-domain',
    })
  })
})
