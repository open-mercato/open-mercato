import { FlushMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CrudFormLeafDefaultProviderFact,
  CrudFormRequiredLeafFact,
  CrudFormSectionMutationSurfaceFact,
} from '../../../modules/form-section-facts'
import type { CrudFormLeafDefaultProvider, CrudFormSectionHostAlternative } from '../../../modules/form-sections'
import type { CrudFormSectionCapabilityEntry } from '../form-section-capabilities'
import { canonicalSectionJson, compareSectionIds } from './composition'
import { roundTripIdSchema, symbolicIdSchema } from './protocol'

type Payload = Record<string, unknown>

type RequiredLeaf = Pick<CrudFormRequiredLeafFact, 'payloadPath' | 'schemaId'> & {
  mutationSurfaceId: string
}

export type CrudFormRequiredLeafCoverage =
  | RequiredLeaf & { mode: 'section'; sectionId: string }
  | RequiredLeaf & { mode: 'preserve-from-record'; fieldLabelKey: string }
  | RequiredLeaf & { mode: 'server-default'; fieldLabelKey: string; provider: CrudFormLeafDefaultProviderFact }

type HiddenLeafCoverage = Exclude<CrudFormRequiredLeafCoverage, { mode: 'section' }>
type CoverageFailure = 'required_leaf_uncovered' | 'required_leaf_ambiguous'

const reservedPathSegments = new Set(['__proto__', 'prototype', 'constructor'])

function isPayloadPath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= 256
    && path.split('.').every((segment) => /^[A-Za-z0-9_:-]+$/.test(segment) && !reservedPathSegments.has(segment))
}

function exactlyOnce(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function defaultProviderFact(provider: CrudFormLeafDefaultProvider): CrudFormLeafDefaultProviderFact | null {
  const { fact } = provider
  if (!fact || typeof provider.resolve !== 'function'
      || !symbolicIdSchema.safeParse(fact.id).success || !roundTripIdSchema.safeParse(fact.roundTripId).success
      || !fact.roundTripId.startsWith(`${fact.id}@v`) || !/^[1-9][0-9]*$/.test(fact.roundTripId.slice(fact.id.length + 2))
      || !Array.isArray(fact.readsPayloadPaths) || !fact.readsPayloadPaths.every(isPayloadPath)
      || !exactlyOnce(fact.readsPayloadPaths) || !isPayloadPath(fact.payloadPath)) return null
  return {
    id: fact.id,
    roundTripId: fact.roundTripId,
    hostId: fact.hostId,
    formVariant: fact.formVariant,
    formOperation: fact.formOperation,
    payloadPath: fact.payloadPath,
    readsPayloadPaths: [...fact.readsPayloadPaths].sort(compareSectionIds),
  }
}

export function selectCrudFormRequiredLeaves(input: {
  alternative: CrudFormSectionHostAlternative
  surfaces: readonly CrudFormSectionMutationSurfaceFact[]
  capabilities: Iterable<CrudFormSectionCapabilityEntry>
  defaultProviders: readonly CrudFormLeafDefaultProvider[]
  canReadLockedRecord: boolean
}): {
  ok: true
  leaves: CrudFormRequiredLeafCoverage[]
  capabilities: CrudFormSectionCapabilityEntry[]
} | { ok: false; reason: CoverageFailure } {
  const { alternative, surfaces, canReadLockedRecord } = input
  const { surface, requiredSectionLeaves = [], preservedLeafPaths = [], requiredLeafLabelKeys = {} } = alternative
  const defaults = input.defaultProviders.filter(({ fact }) => fact?.hostId === surface.hostId
    && fact.formVariant === surface.formVariant && fact.formOperation === surface.formOperation)
  const registered = [...input.capabilities].filter(({ fact }) => fact.hostId === surface.hostId
    && fact.formVariant === surface.formVariant && fact.formOperation === surface.formOperation)
  const leaves: CrudFormRequiredLeafCoverage[] = []
  const capabilities = new Map<string, CrudFormSectionCapabilityEntry>()
  for (const mutation of surfaces.filter(({ kind }) => kind === 'parent-submit')) {
    const matches = registered.filter(({ fact }) => fact.mutationSurfaces.some((candidate) =>
      canonicalSectionJson(candidate) === canonicalSectionJson(mutation)))
    if (!matches.length) return { ok: false, reason: 'required_leaf_uncovered' }
    const required = new Map<string, CrudFormRequiredLeafFact>()
    for (const match of matches) {
      capabilities.set(match.fact.capabilityId, match)
      for (const leaf of match.fact.requiredLeaves) {
        const previous = required.get(leaf.payloadPath)
        if (previous && canonicalSectionJson(previous) !== canonicalSectionJson(leaf)) {
          return { ok: false, reason: 'required_leaf_ambiguous' }
        }
        required.set(leaf.payloadPath, leaf)
      }
    }

    for (const [payloadPath, fact] of [...required.entries()].sort(([left], [right]) => compareSectionIds(left, right))) {
      if (!isPayloadPath(payloadPath)) return { ok: false, reason: 'required_leaf_uncovered' }
      const requiredLeaf = { payloadPath, schemaId: fact.schemaId, mutationSurfaceId: mutation.id }
      const ownedSections = surface.ownershipFacts.filter(({ payloadPaths }) => payloadPaths.includes(payloadPath))
      const sectionProofs = requiredSectionLeaves.filter((entry) => entry.payloadPath === payloadPath)
      const preserved = preservedLeafPaths.filter((path) => path === payloadPath)
      const providers = defaults.filter((provider) => provider.fact.payloadPath === payloadPath)
      if (sectionProofs.length > 1 || preserved.length > 1 || providers.length > 1) {
        return { ok: false, reason: 'required_leaf_ambiguous' }
      }
      const [sectionProof] = sectionProofs
      const [defaultProvider] = providers
      const candidates: CrudFormRequiredLeafCoverage[] = []
      if (sectionProof && fact.coverage.includes('section')
          && ownedSections.some(({ sectionId }) => sectionId === sectionProof.sectionId)) {
        candidates.push({ ...requiredLeaf, mode: 'section', sectionId: sectionProof.sectionId })
      }
      const label = Object.hasOwn(requiredLeafLabelKeys, payloadPath) ? requiredLeafLabelKeys[payloadPath] : undefined
      const canReportHiddenLeaf = typeof label === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/.test(label)
      if (preserved.length && canReportHiddenLeaf && fact.coverage.includes('preserve-from-record')
          && surface.formOperation === 'update' && canReadLockedRecord) {
        candidates.push({ ...requiredLeaf, mode: 'preserve-from-record', fieldLabelKey: label })
      }
      if (defaultProvider && canReportHiddenLeaf && fact.coverage.includes('server-default')
          && (surface.formOperation === 'create' || canReadLockedRecord)) {
        const provider = defaultProviderFact(defaultProvider)
        if (provider && input.defaultProviders.filter(({ fact: declared }) => declared?.id === provider.id).length === 1
            && provider.readsPayloadPaths.every((path) => surface.ownershipFacts.some((owner) => owner.payloadPaths.includes(path)))) {
          candidates.push({ ...requiredLeaf, mode: 'server-default', fieldLabelKey: label, provider })
        }
      }
      if (candidates.length !== 1) return {
        ok: false,
        reason: candidates.length ? 'required_leaf_ambiguous' : 'required_leaf_uncovered',
      }
      const [coverage] = candidates
      if (coverage.mode !== 'section' && ownedSections.length) return { ok: false, reason: 'required_leaf_ambiguous' }
      leaves.push(coverage)
    }
  }
  return { ok: true, leaves, capabilities: [...capabilities.values()] }
}

function isPlainRecord(value: unknown): value is Payload {
  if (value === null || typeof value !== 'object') return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}

export function readCrudFormRequiredLeaf(payload: Readonly<Payload>, path: string): unknown {
  let current: unknown = payload
  for (const segment of path.split('.')) {
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

export function hasRequiredLeafValue(value: unknown): boolean {
  return value != null && (typeof value !== 'string' || value.trim().length > 0)
    && (!Array.isArray(value) || value.length > 0)
}

function writeLeaf(payload: Payload, path: string, value: unknown): void {
  const segments = path.split('.')
  const leaf = segments.pop()!
  let current = payload
  for (const segment of segments) {
    const entry = Object.hasOwn(current, segment) ? current[segment] : undefined
    if (entry !== undefined && !isPlainRecord(entry)) {
      throw new Error('[internal] Required leaf parent must be an object')
    }
    if (!entry) current[segment] = {}
    current = current[segment] as Payload
  }
  current[leaf] = value
}

function projectPayload(payload: Payload, paths: readonly string[]): Payload {
  const projected: Payload = {}
  for (const path of paths) {
    const value = readCrudFormRequiredLeaf(payload, path)
    if (value !== undefined) writeLeaf(projected, path, structuredClone(value))
  }
  return projected
}

function readOnlyFork(em: EntityManager): Parameters<CrudFormLeafDefaultProvider['resolve']>[0]['readEm'] {
  const fork = em.fork({ keepTransactionContext: true, flushMode: FlushMode.COMMIT, disableContextResolution: true })
  const reader: Parameters<CrudFormLeafDefaultProvider['resolve']>[0]['readEm'] = {
    find(entityName, where) {
      return fork.find(entityName, where, { disableIdentityMap: true, flushMode: FlushMode.COMMIT })
    },
    findOne(entityName, where) {
      return fork.findOne(entityName, where, { disableIdentityMap: true, flushMode: FlushMode.COMMIT })
    },
    count(entityName, where) {
      return fork.count(entityName, where, { flushMode: FlushMode.COMMIT })
    },
  }
  return Object.freeze(reader)
}

export async function prepareCrudFormRequiredLeaves(input: {
  payload: Payload
  leaves: readonly CrudFormRequiredLeafCoverage[]
  lockedRecord: Readonly<Payload> | null
  scope: Parameters<CrudFormLeafDefaultProvider['resolve']>[0]['scope']
  transactionalEm: EntityManager
  providers: ReadonlyMap<string, CrudFormLeafDefaultProvider>
}): Promise<{ ok: true; payload: Payload; serverValues: Map<string, unknown> } | { ok: false; leaf: HiddenLeafCoverage }> {
  const payload = structuredClone(input.payload)
  const serverValues = new Map<string, unknown>()
  for (const leaf of input.leaves) {
    if (leaf.mode === 'section') continue
    try {
      const provider = leaf.mode === 'server-default' ? input.providers.get(leaf.provider.id) : undefined
      const value = leaf.mode === 'preserve-from-record'
        ? input.lockedRecord && readCrudFormRequiredLeaf(input.lockedRecord, leaf.payloadPath)
        : await provider?.resolve({
          payload: projectPayload(input.payload, leaf.provider.readsPayloadPaths),
          lockedRecord: input.lockedRecord && structuredClone(input.lockedRecord),
          scope: input.scope,
          readEm: readOnlyFork(input.transactionalEm),
        })
      if (!hasRequiredLeafValue(value)) return { ok: false, leaf }
      writeLeaf(payload, leaf.payloadPath, structuredClone(value))
      serverValues.set(leaf.payloadPath, structuredClone(value))
    } catch {
      return { ok: false, leaf }
    }
  }
  return { ok: true, payload, serverValues }
}
