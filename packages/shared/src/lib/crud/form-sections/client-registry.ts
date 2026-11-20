import type { CrudFormSectionAddress } from '../../../modules/form-section-facts'
import type { CrudFormSectionClientHostFact, CrudFormSectionRuntimeEntry } from '../../../modules/form-sections'
import type { FormSectionOverridesMap } from '../../../modules/overrides'

export type CrudFormSectionClientVersionedSink = Readonly<Omit<CrudFormSectionAddress, 'sectionId'> & {
  id: string
  ownerModuleId: string
  kind: 'table' | 'external'
  payloadPaths: readonly string[]
}>

export type CrudFormSectionClientRegistry = {
  hostFacts: readonly CrudFormSectionClientHostFact[]
  runtimeEntries: readonly CrudFormSectionRuntimeEntry[]
  versionedSinks?: readonly CrudFormSectionClientVersionedSink[]
  contributedOverrides: Readonly<FormSectionOverridesMap>
}

type CrudFormSectionClientRegistryState =
  | { state: 'pending' | 'failed' }
  | { state: 'ready'; registry: CrudFormSectionClientRegistry }

let snapshot: CrudFormSectionClientRegistryState = { state: 'pending' }
const subscribers = new Set<() => void>()

function publish(next: CrudFormSectionClientRegistryState): void {
  snapshot = next
  for (const subscriber of subscribers) subscriber()
}

export function registerCrudFormSectionClientRegistry(registry: CrudFormSectionClientRegistry): void {
  publish({ state: 'ready', registry })
}

export function failCrudFormSectionClientRegistry(): void {
  publish({ state: 'failed' })
}

export function getCrudFormSectionClientRegistryState(): CrudFormSectionClientRegistryState {
  return snapshot
}

export function subscribeCrudFormSectionClientRegistry(subscriber: () => void): () => void {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}
