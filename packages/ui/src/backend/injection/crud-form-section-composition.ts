import type { CrudFormSectionClientRegistry } from '@open-mercato/shared/lib/crud/form-sections/client-registry'
import {
  compareSectionIds,
  applyCrudFormSectionPlacements,
  crudFormSectionConfiguredHosts,
  crudFormSectionHostKey,
} from '@open-mercato/shared/lib/crud/form-sections/composition'
import { roundTripIdSchema, symbolicIdSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import { composeFormSectionOverrides } from '@open-mercato/shared/modules/overrides'
import { isRecord } from '@open-mercato/shared/lib/utils'
import type { CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import type { CrudFormSectionDescriptorIdentity, CrudFormSectionRuntimeEntry } from '@open-mercato/shared/modules/form-sections'
import type { CrudFormSectionIdentity } from './crud-form-section-identity'
import type { CrudFormSectionRuntime } from './crud-form-section-runtime'

export function sameCrudFormSectionIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function selectCrudFormSectionComposition(registry: CrudFormSectionClientRegistry, identity: CrudFormSectionIdentity) {
  const hostKey = crudFormSectionHostKey(identity)
  const matchesTuple = (surface: CrudFormSectionSurfaceAlternativeFact) =>
    surface.hostId === identity.hostId && surface.formVariant === identity.formVariant && surface.formOperation === identity.formOperation
  const hostFacts = registry.hostFacts.filter((fact) => fact.alternatives.some(matchesTuple))
  const [host] = hostFacts
  const configured = crudFormSectionConfiguredHosts(hostFacts, composeFormSectionOverrides(registry.contributedOverrides)).get(hostKey)
  if (hostFacts.length !== 1 || !host.hostResourceKind || !configured || configured.invalid) return null
  const overrides = configured.overrides
  const selectedIds = [...overrides.values()].map(({ contributionId }) => contributionId).sort(compareSectionIds)
  if (new Set(selectedIds).size !== selectedIds.length) return null
  const alternatives = host.alternatives.filter(matchesTuple)
  const baselines = alternatives.filter(({ contributionIds }) => contributionIds.length === 0)
  const matches = alternatives.filter(({ contributionIds }) => sameCrudFormSectionIds([...contributionIds].sort(compareSectionIds), selectedIds))
  if (baselines.length !== 1 || matches.length !== 1) return null
  const [baseline] = baselines
  const [surface] = matches
  const baseIds = new Set(baseline.orderedSectionIds)
  if (baseIds.size !== baseline.orderedSectionIds.length
      || [...overrides].some(([id, { operation }]) => baseIds.has(id) === (operation === 'add'))) return null
  const ordered = applyCrudFormSectionPlacements(baseline.orderedSectionIds, overrides)
  if (!ordered || new Set(ordered).size !== ordered.length || !sameCrudFormSectionIds(ordered, surface.orderedSectionIds)) return null

  const entries = new Map<string, CrudFormSectionRuntimeEntry>()
  const neededIds = new Set([host.id, ...selectedIds])
  if (neededIds.size !== selectedIds.length + 1) return null
  for (const entry of registry.runtimeEntries) {
    if (!neededIds.has(entry.id)) continue
    if (entries.has(entry.id)) return null
    entries.set(entry.id, entry)
  }
  const hostEntry = entries.get(host.id)
  if (!hostEntry || hostEntry.kind !== 'host' || hostEntry.roundTripId !== host.roundTripId) return null
  const contributions = [...overrides].flatMap(([sectionId, override]) => {
    const entry = entries.get(override.contributionId)
    return entry?.kind === 'contribution' ? [{ sectionId, override, entry }] : []
  })
  if (contributions.length !== overrides.size) return null
  return { host, hostEntry, baseline, surface, overrides, contributions }
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
}

function isRuntimeDescriptor<TValues, TPayload>(value: unknown): value is CrudFormSectionRuntime<TValues, TPayload> {
  return isRecord(value) && typeof value.id === 'string' && symbolicIdSchema.safeParse(value.id).success
    && typeof value.roundTripId === 'string' && roundTripIdSchema.safeParse(value.roundTripId).success
    && value.roundTripId.startsWith(`${value.id}@v`) && /^[1-9][0-9]*$/.test(value.roundTripId.slice(value.id.length + 2))
    && isRecord(value.group) && symbolicIdSchema.safeParse(value.group.id).success
    && (value.group.fields === undefined || (Array.isArray(value.group.fields) && value.group.fields.every(
      (field: unknown) => typeof field === 'string' || (isRecord(field) && typeof field.id === 'string'),
    )))
    && isStringList(value.ownedFieldPaths) && typeof value.validateAndProject === 'function'
    && ['requiredSectionIds', 'requiredDataContractIds', 'providedDataContractIds', 'mutationSurfaceIds']
      .every((key) => value[key] === undefined || isStringList(value[key]))
}

async function loadRuntime(
  entry: CrudFormSectionRuntimeEntry,
): Promise<(Record<string, unknown> & CrudFormSectionDescriptorIdentity) | null> {
  const value: unknown = (await entry.load()).crudFormSectionRuntime
  return isRecord(value) && value.id === entry.id && value.roundTripId === entry.roundTripId
    ? { ...value, id: entry.id, roundTripId: entry.roundTripId }
    : null
}

export function crudFormSectionDescriptorKey(descriptor: { id: string; roundTripId: string; group: { id: string } }): string {
  return JSON.stringify([descriptor.group.id, descriptor.id, descriptor.roundTripId])
}

export async function loadCrudFormSectionComposition<TValues, TPayload>(
  selection: NonNullable<ReturnType<typeof selectCrudFormSectionComposition>>,
  baseGroupIds: readonly string[],
  authoredDescriptorKeys: readonly string[] | undefined,
) {
  const { hostEntry, baseline, surface, contributions } = selection
  if (!sameCrudFormSectionIds(baseGroupIds, baseline.orderedSectionIds)) return null
  const [hostRuntime, ...contributionRuntimes] = await Promise.all([
    loadRuntime(hostEntry), ...contributions.map(({ entry }) => loadRuntime(entry)),
  ])
  if (!hostRuntime || contributionRuntimes.some((descriptor) => descriptor === null)) return null

  const base: unknown[] = Array.isArray(hostRuntime.sectionDescriptors) ? hostRuntime.sectionDescriptors : [hostRuntime]
  if (!base.every(isRuntimeDescriptor<TValues, TPayload>) || new Set(base.map(({ id }) => id)).size !== base.length
      || !sameCrudFormSectionIds(base.map(({ group }) => group.id), baseGroupIds)
      || (authoredDescriptorKeys && !sameCrudFormSectionIds(base.map(crudFormSectionDescriptorKey), authoredDescriptorKeys))) return null
  const active = new Map(base.map((descriptor) => [descriptor.group.id, descriptor]))
  for (const [index, { sectionId, override }] of contributions.entries()) {
    const runtime = contributionRuntimes[index]
    if (override.operation === 'hide') active.delete(sectionId)
    else if (isRuntimeDescriptor<TValues, TPayload>(runtime) && runtime.group.id === sectionId) active.set(sectionId, runtime)
    else return null
  }
  const ordered = surface.orderedSectionIds.flatMap((id) => {
    const descriptor = active.get(id)
    return descriptor ? [descriptor] : []
  })
  if (ordered.length !== active.size || ordered.length !== surface.orderedSectionIds.length
      || new Set(ordered.map(({ id }) => id)).size !== ordered.length) return null
  const identities = [hostRuntime, ...contributionRuntimes].filter((runtime) => runtime !== null)
    .map(({ id, roundTripId }) => ({ id, roundTripId }))
  return { descriptors: ordered, identities }
}
