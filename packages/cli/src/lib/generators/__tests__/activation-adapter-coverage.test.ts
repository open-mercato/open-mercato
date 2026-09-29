import {
  ACTIVATION_ADAPTERS,
  ALL_ACTIVATION_KINDS,
  ALL_CONTRIBUTION_KINDS,
  CONTRIBUTION_ACTIVATION_CLASSIFICATION,
} from '../module-extension-facts'
import type {
  ModuleExtensionActivationKind,
  ModuleExtensionContributionKind,
} from '@open-mercato/shared/modules/widgets/extension-points'

// Explicit expected inventories. Adding a UMES activation kind or contribution
// kind to the shared union forces the typed Record in module-extension-facts.ts
// to gain a key (compile-time gate) AND requires updating these lists (this
// coverage gate), so an unclassified kind cannot ship silently.
const EXPECTED_ACTIVATION_KINDS: ModuleExtensionActivationKind[] = [
  'crud-response-enricher',
  'query-enricher',
  'mutation-guard',
  'api-interceptor-bridge',
  'command-interceptor-bridge',
  'widget-injection-consumer',
  'component-extension-consumer',
  'dashboard-host-consumer',
]

const EXPECTED_CONTRIBUTION_KINDS: ModuleExtensionContributionKind[] = [
  'widget',
  'data-table',
  'crud-form',
  'component-override',
  'response-enricher',
  'api-interceptor',
  'command-interceptor',
  'mutation-guard',
  'entity-extension',
  'subscriber',
  'browser-reaction',
  'specialized-registry',
  'module-override',
]

// Route/entity-bound contribution kinds MUST bind through an activation adapter —
// never be silently classified as capability-only.
const ROUTE_OR_ENTITY_BOUND_KINDS: ModuleExtensionContributionKind[] = [
  'response-enricher',
  'mutation-guard',
  'api-interceptor',
  'command-interceptor',
]

describe('activation adapter coverage', () => {
  it('registers exactly the expected closed set of activation adapters', () => {
    expect([...ALL_ACTIVATION_KINDS].sort()).toEqual([...EXPECTED_ACTIVATION_KINDS].sort())
    expect(Object.keys(ACTIVATION_ADAPTERS).sort()).toEqual([...EXPECTED_ACTIVATION_KINDS].sort())
  })

  it('classifies exactly the expected closed set of contribution kinds', () => {
    expect([...ALL_CONTRIBUTION_KINDS].sort()).toEqual([...EXPECTED_CONTRIBUTION_KINDS].sort())
    expect(Object.keys(CONTRIBUTION_ACTIVATION_CLASSIFICATION).sort()).toEqual([...EXPECTED_CONTRIBUTION_KINDS].sort())
  })

  it('maps every contribution kind to a real adapter whose contributionKinds accept it, or to a tested capability-only classification', () => {
    for (const kind of ALL_CONTRIBUTION_KINDS) {
      const classification = CONTRIBUTION_ACTIVATION_CLASSIFICATION[kind]
      if (classification === 'capability-only') {
        expect(ROUTE_OR_ENTITY_BOUND_KINDS).not.toContain(kind)
        continue
      }
      expect(classification.length).toBeGreaterThan(0)
      for (const activationKind of classification) {
        const adapter = ACTIVATION_ADAPTERS[activationKind]
        expect(adapter).toBeDefined()
        expect(adapter.contributionKinds).toContain(kind)
      }
    }
  })

  it('requires every route/entity-bound contribution kind to have an activation adapter (never capability-only)', () => {
    for (const kind of ROUTE_OR_ENTITY_BOUND_KINDS) {
      const classification = CONTRIBUTION_ACTIVATION_CLASSIFICATION[kind]
      expect(classification).not.toBe('capability-only')
    }
  })

  it('keeps a call-site-object adapter for every kind that distinguishes bound from capability-only by opt-in', () => {
    const callSiteKinds = ALL_ACTIVATION_KINDS.filter((kind) => ACTIVATION_ADAPTERS[kind].mode === 'call-site-object')
    // Enricher (response + query) and mutation-guard opt-ins are the only surfaces
    // whose activation presence is NOT implied by mere host existence.
    expect(callSiteKinds.sort()).toEqual(['crud-response-enricher', 'mutation-guard', 'query-enricher'])
  })
})
