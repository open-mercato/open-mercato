import { z } from "zod"
import type { CrudFormSectionMutationSurfaceFact, CrudFormSectionSurfaceAlternativeFact } from '../../../../modules/form-section-facts'
import type { CrudFormSectionServerModule } from '../../../../modules/form-sections'
import type { FormSectionOverridesMap } from '../../../../modules/overrides'
import { registerMutationGuards } from '../../mutation-guard-store'
import { InjectionPosition } from '../../../../modules/widgets/injection-position'
import { crudFormSectionHostKey, computeCrudFormSectionClientFingerprint, canonicalSectionJson } from '../composition'
import { buildCrudFormSectionManifest } from '../manifest'
import { decodeCrudFormSectionPolicyToken, encodeCrudFormSectionPolicyToken } from '../policy-token'
import type { CrudFormSectionPolicyTokenBody } from '../protocol'

const address = { hostId: 'example.todo', formVariant: 'showcase', formOperation: 'update' } as const
const hostId = 'example.host'
const sectionId = 'example.extra'
const contributionId = 'example.display'
const capabilityId = 'example.display-capability'
const key = crudFormSectionHostKey(address)
const plain: CrudFormSectionSurfaceAlternativeFact = {
  ...address,
  id: 'example.baseline',
  orderedSectionIds: ['details'],
  callerIds: ['example.todos'],
  contributionIds: [],
  ownershipFacts: [],
  mutationSurfaceIds: [],
  dependencies: [],
}
const composed: CrudFormSectionSurfaceAlternativeFact = {
  ...plain,
  id: 'example.display-enabled',
  orderedSectionIds: [sectionId, 'details'],
  contributionIds: [contributionId],
}
const overrideKey = 'example.todo/showcase/update/example.extra'
const overrides: FormSectionOverridesMap = {
  [overrideKey]: { contributionId, operation: 'add', placement: { position: InjectionPosition.First } },
}
const host = {
  id: hostId,
  roundTripId: 'example.host@v1',
  hostResourceKind: 'example.todo',
  alternatives: [{ surface: plain }, { surface: composed }],
}
const contribution = {
  id: contributionId,
  roundTripId: 'example.display@v1',
  operation: 'add',
  address: { ...address, sectionId },
  requiredCapabilities: [{ capabilityId, protocol: 'crud-form-sections/v1', modes: ['display-only'] }],
} as const
const modules: readonly CrudFormSectionServerModule[] = [{
  moduleId: 'example',
  sections: {
    hostFacts: [host],
    hostProviders: [{ hostDescriptorId: hostId, requireFeatures: [], authorizeHost: async () => null }],
    contributionFacts: [contribution],
    displayPolicies: [{
      ...address,
      capabilityId,
      protocol: 'crud-form-sections/v1',
      roundTripId: contribution.roundTripId,
      modes: ['display-only'],
      payloadPaths: [],
      customFieldOwnership: { mode: 'none' },
      mutationSurfaces: [],
      providedDataContractIds: [],
      allowNoopSubmit: false,
      requiredLeaves: [],
      extensionSinkSupport: 'none',
    }],
  },
}]

describe('accepted CrudForm section manifest', () => {
  it('keeps no-policy and null-mask hosts on the identity path', () => {
    expect(buildCrudFormSectionManifest(modules, {}).ledger.hosts).toEqual([])
    expect(buildCrudFormSectionManifest(modules, { [overrideKey]: null }).ledger.hosts).toEqual([])
  })

  it('produces the same client fingerprint from the mirrored surface and runtime descriptor IDs', async () => {
    const manifest = buildCrudFormSectionManifest(modules, overrides)
    const first = overrides[overrideKey]
    if (!first) throw new Error('[internal] Expected fixture override')
    expect(manifest.ledger.hosts).toEqual([address])
    const clientFingerprint = await computeCrudFormSectionClientFingerprint(
      composed, [contribution, host], new Map([[sectionId, first]]),
    )
    expect(manifest.policies.get(key)).toMatchObject({
      roundTripIds: [contribution.roundTripId, host.roundTripId],
      clientFingerprint,
    })
    expect(Object.keys(manifest.ledger)).toEqual(['hosts', 'fingerprint'])
    const drift = await computeCrudFormSectionClientFingerprint(
      composed, [contribution, host],
      new Map([[sectionId, { operation: 'add', contributionId, placement: { position: InjectionPosition.Last } }]]),
    )
    expect(drift).not.toBe(clientFingerprint)
  })

  it('retains the configured host without publishing a partial policy when placement changes', () => {
    const manifest = buildCrudFormSectionManifest(modules, {
      [overrideKey]: { contributionId, operation: 'add', placement: { position: InjectionPosition.Last } },
    })
    expect(manifest.ledger.hosts).toEqual([address])
    expect(manifest.policies.size).toBe(0)
    expect(manifest.providers.has(key)).toBe(true)
  })

  it('fingerprints the final client mutation route and method independently of the surface ID', async () => {
    const serverSurface: CrudFormSectionMutationSurfaceFact = {
      id: 'example.todo.update', kind: 'section-action', requestOperation: 'update',
      guardedFacade: { method: 'PUT', routePattern: '/example/todos/section-policy' },
      delegatedTarget: { kind: 'command', id: 'example.todo.update' },
      hostResourceKind: 'example.todo', mutationResourceKind: 'example.todo', optimisticLock: 'none',
    }
    const surface = { ...composed, mutationSurfaceIds: [serverSurface.id] }
    const sections = modules[0].sections
    const manifest = buildCrudFormSectionManifest([{ ...modules[0], sections: {
      ...sections, hostFacts: [{ ...host, alternatives: [{ surface: plain }, { surface, mutationSurfaces: [serverSurface] }] }],
      hostProviders: [{
        ...sections.hostProviders![0], mutationProviders: [{
          mutationSurfaceId: serverSurface.id, delegatedTarget: serverSurface.delegatedTarget,
          finalInput: 'transactional-final-input/v1',
        }],
      }],
    } }], overrides)
    const { delegatedTarget: _serverOnly, ...browser } = serverSurface
    const inputs = [contribution, host] as const
    const placement = new Map([[sectionId, overrides[overrideKey]!]])
    const fingerprint = await computeCrudFormSectionClientFingerprint({ ...surface, clientMutationSurfaces: [browser] }, inputs, placement)
    expect(manifest.policies.get(key)?.clientFingerprint).toBe(fingerprint)
    expect(manifest.policies.get(key)?.surface.clientMutationSurfaces).toEqual([browser])
    const stale = { ...browser, guardedFacade: { method: 'PATCH' as const, routePattern: '/example/todos/old-policy' } }
    await expect(computeCrudFormSectionClientFingerprint(
      { ...surface, clientMutationSurfaces: [stale] }, inputs, placement,
    )).resolves.not.toBe(fingerprint)
    expect(Object.keys(manifest.ledger)).toEqual(['hosts', 'fingerprint'])
  })

  it('publishes empty submit only for a finite alternative and a matching provider for the exact parent surface', () => {
    const submit: CrudFormSectionMutationSurfaceFact = {
      id: 'example.todo.update', kind: 'parent-submit', requestOperation: 'update',
      guardedFacade: { method: 'PUT', routePattern: '/example/todos/section-policy' },
      delegatedTarget: { kind: 'command', id: 'example.todo.update' },
      hostResourceKind: 'example.todo', mutationResourceKind: 'example.todo', optimisticLock: 'none',
    }
    const action: CrudFormSectionMutationSurfaceFact = { ...submit, id: 'example.todo.action', kind: 'section-action' }
    const sections = modules[0].sections
    function select({
      authored, providerOptIn, includeAction = false, duplicate = false,
    }: { authored?: boolean; providerOptIn: boolean; includeAction?: boolean; duplicate?: boolean }) {
      const mutationSurfaces = includeAction ? [submit, action] : [submit]
      const surface = {
        ...composed, mutationSurfaceIds: mutationSurfaces.map(({ id }) => id), allowNoopSubmit: authored,
      }
      const fixture = { surface, mutationSurfaces }
      const modes = ['domain-adapter'] as const
      const requirement = { capabilityId, protocol: 'crud-form-sections/v1' as const, modes, mutationSurfaceIds: [submit.id] }
      registerMutationGuards([{ moduleId: 'example', guards: [{
        id: 'example.noop', targetEntity: 'example.todo', operations: ['update'], validate: async () => ({ ok: true }),
        crudFormSectionCapabilities: [{
          ...sections.displayPolicies![0], modes, mutationSurfaces: [submit], allowNoopSubmit: providerOptIn,
        }],
      }] }])
      return buildCrudFormSectionManifest([{ ...modules[0], sections: {
        ...sections, displayPolicies: [],
        contributionFacts: [{ ...contribution, requiredCapabilities: [{ ...requirement, allowNoopSubmit: providerOptIn }] }],
        hostFacts: [{ ...host, alternatives: [{ surface: plain }, fixture, ...(duplicate ? [fixture] : [])] }],
        hostProviders: [{
          ...sections.hostProviders![0], mutationProviders: mutationSurfaces.map((candidate) => ({
            mutationSurfaceId: candidate.id, delegatedTarget: candidate.delegatedTarget,
            finalInput: 'transactional-final-input/v1' as const,
          })),
        }],
      } }], overrides).policies.get(key)
    }

    try {
      expect(select({ authored: true, providerOptIn: true })?.surface.allowNoopSubmit).toBe(true)
      const denied = select({ providerOptIn: false })
      expect(denied).toBeDefined()
      expect(denied?.surface.allowNoopSubmit).toBeUndefined()
      expect(select({ authored: true, providerOptIn: false })).toBeUndefined()
      expect(select({ providerOptIn: true })).toBeUndefined()
      expect(select({ authored: true, providerOptIn: true, includeAction: true })).toBeUndefined()
      expect(select({ authored: true, providerOptIn: true, duplicate: true })).toBeUndefined()
    } finally {
      registerMutationGuards([])
    }
  })

  it('blocks unknown contribution IDs without losing the configured host', () => {
    const manifest = buildCrudFormSectionManifest(modules, {
      [overrideKey]: { contributionId: 'other.unknown', operation: 'add' },
    })
    expect(manifest.ledger.hosts).toEqual([address])
    expect(manifest.policies.size).toBe(0)
  })
})

const tokenBody: CrudFormSectionPolicyTokenBody = {
  protocol: 'crud-form-sections/v1',
  schemaVersion: 1,
  ...address,
  hostResourceKind: 'example.todo',
  hostResourceId: 'todo-1',
  contributionIds: [contributionId],
  roundTripIds: [contribution.roundTripId, host.roundTripId],
  capabilityIds: [capabilityId],
  orderedActiveSectionIds: composed.orderedSectionIds.slice(),
  clientManifestFingerprint: 'a'.repeat(64),
  fingerprint: 'b'.repeat(64),
}

function tokenBodyOfSize(size: number): CrudFormSectionPolicyTokenBody {
  const sectionIds = Array.from({ length: 20 }, (_, index) => `section${index}-` + 'a'.repeat(120))
  const body = { ...tokenBody, orderedActiveSectionIds: sectionIds }
  const delta = size - Buffer.byteLength(canonicalSectionJson(body), 'utf8')
  if (Math.abs(delta) >= sectionIds[0].length) throw new Error('[internal] Token test fixture leaves the ID bounds')
  sectionIds[0] = delta < 0 ? sectionIds[0].slice(0, delta) : sectionIds[0] + 'a'.repeat(delta)
  return body
}

describe('canonical CrudForm policy token', () => {
  it('accepts 3072 bytes and rejects 3073 bytes without truncation', () => {
    const atLimit = tokenBodyOfSize(3072)
    const encoded = encodeCrudFormSectionPolicyToken(atLimit)
    expect(encoded).toHaveLength(4096)
    if (!encoded) throw new Error('[internal] Expected a token')
    expect(decodeCrudFormSectionPolicyToken(encoded)).toEqual(atLimit)
    const overLimit = tokenBodyOfSize(3073)
    expect(encodeCrudFormSectionPolicyToken(overLimit)).toBeNull()
    expect(decodeCrudFormSectionPolicyToken(Buffer.from(canonicalSectionJson(overLimit)).toString('base64url'))).toBeNull()
  })

  it('rejects a noncanonical spelling and padding', () => {
    expect(decodeCrudFormSectionPolicyToken(Buffer.from(JSON.stringify(tokenBody, null, 2)).toString('base64url'))).toBeNull()
    const canonical = encodeCrudFormSectionPolicyToken(tokenBody)
    expect(decodeCrudFormSectionPolicyToken(`${canonical}=`)).toBeNull()
  })
})

it('applies the same exact domain authority to a compiled contribution and its sink capability', () => {
  const submit: CrudFormSectionMutationSurfaceFact = {
    id: 'example.todo.update', kind: 'parent-submit', requestOperation: 'update',
    guardedFacade: { method: 'PUT', routePattern: '/example/todos/section-policy' },
    delegatedTarget: { kind: 'command', id: 'example.todo.update' },
    hostResourceKind: 'example.todo', mutationResourceKind: 'example.todo', optimisticLock: 'none',
  }
  const sections = modules[0].sections
  const path = 'extensions.example.note'
  const extension = {
    ...contribution,
    requiredCapabilities: [{
      capabilityId, protocol: 'crud-form-sections/v1', modes: ['domain-adapter'], mutationSurfaceIds: [submit.id],
    }, {
      capabilityId: 'example.store', protocol: 'crud-form-sections/v1', modes: ['extension-sink'],
      mutationSurfaceIds: [submit.id], payloadPaths: [path], allowAfterCommitSink: true,
    }],
  } as const
  const finalSurface: CrudFormSectionSurfaceAlternativeFact = {
    ...composed, mutationSurfaceIds: [submit.id],
    ownershipFacts: [{ sectionId, payloadPaths: [path], customFieldOwnership: { mode: 'none' } }],
  }
  registerMutationGuards([{ moduleId: 'example', guards: [{
    id: 'example.authority', targetEntity: 'example.todo', operations: ['update'], validate: async () => ({ ok: true }),
    crudFormSectionCapabilities: [{
      ...sections.displayPolicies![0], capabilityId: 'example.authority', modes: ['domain-adapter'],
      mutationSurfaces: [submit], extensionSinkSupport: 'host-transaction',
    }],
  }] }])
  try {
    const manifest = buildCrudFormSectionManifest([{ ...modules[0], sections: {
      ...sections,
      displayPolicies: [],
      hostFacts: [{ ...host, alternatives: [{ surface: plain }, { surface: finalSurface, mutationSurfaces: [submit] }] }],
      hostProviders: [{ ...sections.hostProviders![0], mutationProviders: [{
        mutationSurfaceId: submit.id, delegatedTarget: submit.delegatedTarget, finalInput: 'transactional-final-input/v1',
        extensionSinkSupport: 'host-transaction',
      }] }],
      contributionFacts: [extension],
      compiledContributions: [{ contribution: extension }],
      sinks: [{
        fact: {
          ...extension.address, id: 'example.sink', roundTripId: 'example.sink@v1', ownerModuleId: 'example',
          targetEntityId: 'example:todo', payloadPaths: [path], atomicity: 'after-commit',
          optimisticLock: 'none', undo: 'unsupported',
        },
        capabilityId: 'example.store', appendOnly: true, hostDetailEntityId: 'example.todo',
        schema: z.strictObject({ note: z.string() }), persist: async () => ({ before: null, after: null }),
        load: async () => null,
      }],
    } }], overrides)
    expect(manifest.policies.get(key)?.sinks).toHaveLength(1)
  } finally {
    registerMutationGuards([])
  }
})
