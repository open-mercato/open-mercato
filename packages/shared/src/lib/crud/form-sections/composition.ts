import { getInjectionPosition, InjectionPosition, insertByInjectionPlacement } from '../../../modules/widgets/injection-position'
import type { CrudFormSectionAddress, CrudFormSectionSurfaceAlternativeFact } from '../../../modules/form-section-facts'
import type { FormSectionOverride, FormSectionOverridesMap } from '../../../modules/overrides'
import type { CrudFormSectionClientHostFact, CrudFormSectionDescriptorIdentity } from '../../../modules/form-sections'

type HostAddress = Omit<CrudFormSectionAddress, 'sectionId'>
export type CrudFormSectionConfiguredHost = HostAddress

export type CrudFormSectionConfiguredHostLedger = {
  hosts: readonly CrudFormSectionConfiguredHost[]
  fingerprint: string
}

export function canonicalSectionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSectionJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined)
    return `{${entries.sort(([left], [right]) => compareSectionIds(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalSectionJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function compareSectionIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function crudFormSectionHostKey(address: HostAddress): string {
  return JSON.stringify([address.hostId, address.formVariant, address.formOperation])
}

export function crudFormSectionOverrideKey(address: CrudFormSectionAddress): string {
  return `${address.hostId}/${address.formVariant}/${address.formOperation}/${address.sectionId}`
}

export function crudFormSectionConfiguredHosts(
  hostFacts: readonly CrudFormSectionClientHostFact[],
  overrides: Readonly<FormSectionOverridesMap>,
): Map<string, { address: HostAddress; overrides: Map<string, FormSectionOverride>; invalid: boolean }> {
  const configured = new Map<string, { address: HostAddress; overrides: Map<string, FormSectionOverride>; invalid: boolean }>()
  const hosts = [...new Map(hostFacts.flatMap((fact) => fact.alternatives
    .flatMap((surface) => surface.hostId === null ? [] : [{
      hostId: surface.hostId, formVariant: surface.formVariant, formOperation: surface.formOperation,
    }])).map((address) => [crudFormSectionHostKey(address), address])).values()]
  for (const [key, override] of Object.entries(overrides)) {
    if (override === null) continue
    let matches = hosts.flatMap((address) => {
      const prefix = crudFormSectionOverrideKey({ ...address, sectionId: '' })
      return key.startsWith(prefix) ? [{ address, sectionId: key.slice(prefix.length) }] : []
    })
    if (!matches.length) {
      const parts = /^([^/]+)\/([^/]+)\/(create|update)\/(.+)$/.exec(key)
      if (!parts) continue
      const [, hostId, formVariant, formOperation, sectionId] = parts
      matches = [{ address: { hostId, formVariant, formOperation: formOperation as HostAddress['formOperation'] }, sectionId }]
    }
    for (const { address, sectionId } of matches) {
      const hostKey = crudFormSectionHostKey(address)
      const entry = configured.get(hostKey) ?? { address, overrides: new Map(), invalid: false }
      entry.invalid ||= matches.length !== 1 || sectionId.length === 0
      entry.overrides.set(sectionId, override)
      configured.set(hostKey, entry)
    }
  }
  return configured
}

export function canonicalCrudFormSectionAlternative(
  surface: CrudFormSectionSurfaceAlternativeFact,
): CrudFormSectionSurfaceAlternativeFact {
  return {
    id: surface.id,
    hostId: surface.hostId,
    formVariant: surface.formVariant,
    formOperation: surface.formOperation,
    orderedSectionIds: [...surface.orderedSectionIds],
    callerIds: [...surface.callerIds].sort(),
    contributionIds: [...surface.contributionIds].sort(),
    ownershipFacts: surface.ownershipFacts.map(({ sectionId, payloadPaths, customFieldOwnership }) => ({
      sectionId,
      payloadPaths: [...payloadPaths].sort(),
      customFieldOwnership: customFieldOwnership.mode === 'ids'
        ? { ...customFieldOwnership, ids: [...customFieldOwnership.ids].sort() }
        : customFieldOwnership,
    })).sort((left, right) => compareSectionIds(left.sectionId, right.sectionId)),
    mutationSurfaceIds: [...surface.mutationSurfaceIds].sort(),
    ...(surface.clientMutationSurfaces?.length ? {
      clientMutationSurfaces: [...surface.clientMutationSurfaces].sort((a, b) => compareSectionIds(a.id, b.id)),
    } : {}),
    ...(surface.allowNoopSubmit === true ? { allowNoopSubmit: true } : {}),
    dependencies: surface.dependencies.map((dependency) => ({
      consumerContributionId: dependency.consumerContributionId,
      requiredSectionIds: [...dependency.requiredSectionIds].sort(),
      requiredDataContractIds: [...dependency.requiredDataContractIds].sort(),
    })).sort((left, right) => compareSectionIds(left.consumerContributionId, right.consumerContributionId)),
  }
}

export function hasCrudFormSectionWritableLeaves({ ownershipFacts }: Pick<CrudFormSectionSurfaceAlternativeFact, 'ownershipFacts'>): boolean {
  return ownershipFacts.some(({ payloadPaths, customFieldOwnership }) => payloadPaths.length > 0
    || customFieldOwnership.mode === 'all'
    || (customFieldOwnership.mode === 'ids' && customFieldOwnership.ids.length > 0))
}

export function applyCrudFormSectionPlacements(
  orderedBaseIds: readonly string[],
  overrides: ReadonlyMap<string, FormSectionOverride>,
): string[] | null {
  let ordered = orderedBaseIds.filter((sectionId) => overrides.get(sectionId)?.operation !== 'hide')
  for (const [sectionId, override] of [...overrides.entries()].sort(([left], [right]) => compareSectionIds(left, right))) {
    if (override.operation !== 'add') continue
    const placement = getInjectionPosition(override.placement)
    if (!Object.values(InjectionPosition).includes(placement)) return null
    if ((placement === InjectionPosition.Before || placement === InjectionPosition.After)
        && (!override.placement?.relativeTo || !ordered.includes(override.placement.relativeTo))) return null
    ordered = insertByInjectionPlacement(ordered, sectionId, override.placement, (id) => id)
  }
  return ordered
}

export function crudFormSectionClientFingerprintInput(
  surface: CrudFormSectionSurfaceAlternativeFact,
  descriptors: readonly CrudFormSectionDescriptorIdentity[],
  overrides: ReadonlyMap<string, FormSectionOverride>,
): string {
  return canonicalSectionJson({
    surface: canonicalCrudFormSectionAlternative(surface),
    overrides: [...overrides.entries()].sort(([left], [right]) => compareSectionIds(left, right)),
    descriptors: descriptors.map(({ id, roundTripId }) => [id, roundTripId])
      .sort(([left], [right]) => compareSectionIds(left, right)),
  })
}

export async function computeCrudFormSectionClientFingerprint(
  surface: CrudFormSectionSurfaceAlternativeFact,
  descriptors: readonly CrudFormSectionDescriptorIdentity[],
  overrides: ReadonlyMap<string, FormSectionOverride>,
): Promise<string> {
  const bytes = new TextEncoder().encode(crudFormSectionClientFingerprintInput(surface, descriptors, overrides))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
