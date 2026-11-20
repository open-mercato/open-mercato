import type {
  CrudFormExtensionSinkFact, CrudFormSectionAddress, CrudFormSectionContributionFact, CrudFormSectionSurfaceAlternativeFact,
} from '../../../modules/form-section-facts'
import type {
  CrudFormLeafDefaultProvider, CrudFormSectionHostAlternative, CrudFormSectionServerModule, CrudFormSectionSink,
} from '../../../modules/form-sections'
import type { CompiledStoreEntityExports } from './compiled-store-entities'
import type { CustomFieldKind } from '../../../modules/entities'
import type { CrudFormSectionOutboxDelivery } from './outbox'
import { bindCompiledCrudFormGenericSink, type CompiledCrudFormValueField } from './compiled-sinks'
import { copyDerivedCrudRouteCapabilities } from './factory-route-source'
import { evaluateCrudFormFieldRules, type CrudFormNormalizedFieldRule } from './field-rules'
import { readCrudFormRequiredLeaf } from './required-leaves'

type Values = Readonly<Record<string, unknown>>

export type CompiledCrudFormFieldContext = Readonly<{
  address: Readonly<CrudFormSectionAddress>
  fieldId: string
  payloadPath: string
  values: Values
  scope: Readonly<Parameters<CrudFormLeafDefaultProvider['resolve']>[0]['scope']>
  hostResourceKind: string
  hostResourceId?: string
  actorId: string
}>

export type CompiledCrudFormFieldRule = Readonly<{
  fieldId: string
  payloadPath: string
  rules: readonly CrudFormNormalizedFieldRule[]
  server?: (value: unknown, context: CompiledCrudFormFieldContext) => true | string | Promise<true | string>
}>

export type CrudFormCompiledSinkStore = Omit<CrudFormSectionSink, 'fact' | 'capabilityId' | 'hostDetailEntityId' | 'outbox'> & {
  entityId: string
  atomicity: Exclude<CrudFormExtensionSinkFact['atomicity'], 'outbox'>
  optimisticLock?: CrudFormExtensionSinkFact['optimisticLock']
  undoMode?: CrudFormExtensionSinkFact['undo']
}

export type CrudFormCompiledStoreSource =
  | Readonly<{ kind: 'customField'; key?: string }>
  | Readonly<{ kind: 'table'; entityId: string }>
  | Readonly<{ kind: 'sink'; config: CrudFormCompiledSinkStore }>
  | Readonly<{ kind: 'external'; config: Pick<CrudFormSectionOutboxDelivery, 'deliver' | 'validateExternal'> & {
      integrationId: string; mirror: string; contractId?: `${string}@v${number}`; maxAttempts?: number; failureNotificationType?: string
    } }>

export type CompiledCrudFormCustomField = Readonly<{
  entityId: string
  definitionSetId: string
  key: string
  kind: CustomFieldKind
}>

export type CompiledCrudFormStoreBinding = Readonly<{
  ownerModuleId: string
  fieldId: string
  payloadPath: string
  store: CrudFormCompiledStoreSource
  customField?: CompiledCrudFormCustomField
}>

export type CompiledCrudFormSinkAssociation = Readonly<{
  ownerModuleId: string
  id: string
  roundTripId: string
  capabilityId: string
  hostDetailEntityId: string
  payloadPaths: readonly string[]
  store: Exclude<CrudFormCompiledStoreSource, { kind: 'customField' }>
  fields?: readonly CompiledCrudFormValueField[]
  entityExports?: CompiledStoreEntityExports
}>

export function bindCompiledCrudFormSink(
  association: CompiledCrudFormSinkAssociation,
  address: CrudFormSectionAddress,
): CrudFormSectionSink | null {
  if (association.store.kind !== 'sink') return bindCompiledCrudFormGenericSink(association, address)
  const { config } = association.store
  if (!config.entityId.startsWith(association.ownerModuleId + ':')) return null
  const fact = {
    ...address, id: association.id, roundTripId: association.roundTripId, ownerModuleId: association.ownerModuleId,
    targetEntityId: config.entityId, payloadPaths: association.payloadPaths,
    atomicity: config.atomicity, optimisticLock: config.optimisticLock ?? 'sink-version',
    undo: config.undoMode ?? (config.undo ? 'snapshot' : 'unsupported'),
  } satisfies CrudFormExtensionSinkFact
  const { appendOnly, schema, persist, load, lockRow, undo, onHostDeleted } = config
  return { fact, capabilityId: association.capabilityId, hostDetailEntityId: association.hostDetailEntityId,
    appendOnly, schema, persist, load, lockRow, undo, onHostDeleted }
}

export type CompiledCrudFormContribution = Readonly<{
  contribution: CrudFormSectionContributionFact
  fieldRules?: readonly CompiledCrudFormFieldRule[]
  defaults?: readonly CrudFormLeafDefaultProvider[]
  stores?: readonly CompiledCrudFormStoreBinding[]
  sinkAssociations?: readonly CompiledCrudFormSinkAssociation[]
}>

export type CompiledCrudFormAlternative = Readonly<{
  hostDescriptorId: string
  proofAlternativeId: string
  surface: CrudFormSectionSurfaceAlternativeFact
  defaultProviders: readonly { id: string; payloadPath: string }[]
}>

export function bindCompiledCrudFormAlternatives(
  module: CrudFormSectionServerModule,
  alternatives: readonly CompiledCrudFormAlternative[],
): CrudFormSectionServerModule {
  const { sections } = module
  const hostFacts = (sections.hostFacts ?? []).map((host) => {
    const added = alternatives.filter(({ hostDescriptorId }) => hostDescriptorId === host.id)
    if (!added.length) return host
    const original = host.alternatives ?? []
    const generated = added.flatMap(({ proofAlternativeId, surface, defaultProviders }): CrudFormSectionHostAlternative[] => {
      const source = original.find(({ surface: candidate }) => candidate.id === proofAlternativeId)
      if (!source) return []
      const base = original.find(({ surface: candidate }) => candidate.hostId === surface.hostId
        && candidate.formVariant === surface.formVariant && candidate.formOperation === surface.formOperation
        && !candidate.contributionIds.length)
      const owned = surface.ownershipFacts.flatMap(({ sectionId, payloadPaths }) => payloadPaths.map((payloadPath) => ({ sectionId, payloadPath })))
      const trustedLeaves = new Set([...source.requiredSectionLeaves ?? [], ...base?.requiredSectionLeaves ?? []]
        .map(({ payloadPath }) => payloadPath))
      const defaultPathSet = new Set(defaultProviders.map(({ payloadPath }) => payloadPath))
      const { clientMutationSurfaces: _clientFacts, ...serverSurface } = surface
      return [{
        ...source,
        surface: serverSurface,
        requiredSectionLeaves: owned.filter(({ payloadPath }) => trustedLeaves.has(payloadPath)),
        preservedLeafPaths: (source.preservedLeafPaths ?? []).filter((path) =>
          !defaultPathSet.has(path) && !owned.some(({ payloadPath }) => payloadPath === path)),
        compiledDefaultProviderIds: defaultProviders.map(({ id }) => id),
      }]
    })
    return { ...host, alternatives: [...original, ...generated] }
  })
  const bound = { ...sections, hostFacts }
  copyDerivedCrudRouteCapabilities(sections, bound)
  return { ...module, sections: bound }
}

export async function validateCompiledCrudFormFieldRules(
  compiledRules: readonly { address: CrudFormSectionAddress; rule: CompiledCrudFormFieldRule }[],
  context: Omit<CompiledCrudFormFieldContext, 'address' | 'fieldId' | 'payloadPath'>,
): Promise<Record<string, string>> {
  const errors = new Map<string, string>()
  for (const { address, rule: { fieldId, payloadPath, rules, server } } of compiledRules) {
    if (errors.has(payloadPath)) continue
    const value = readCrudFormRequiredLeaf(context.values, payloadPath)
    if (value === undefined) continue
    const declarative = evaluateCrudFormFieldRules(value, rules, 'server')
    if (declarative) {
      errors.set(payloadPath, declarative)
      continue
    }
    if (!server) continue
    const answer = await server(structuredClone(value), { ...context, values: structuredClone(context.values), scope: structuredClone(context.scope), address: { ...address }, fieldId, payloadPath })
    if (answer !== true) {
      errors.set(payloadPath, typeof answer === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/.test(answer) ? answer : 'ui.forms.errors.highlighted')
    }
  }
  return Object.fromEntries(errors)
}

export function bindCompiledCrudFormContributions(
  sections: CrudFormSectionServerModule['sections'],
  compiled: readonly CompiledCrudFormContribution[],
  overrides: NonNullable<CrudFormSectionServerModule['sections']['contributedOverrides']>,
): CrudFormSectionServerModule['sections'] {
  const bound = {
    ...sections,
    contributionFacts: [...sections.contributionFacts ?? [], ...compiled.map(({ contribution }) => contribution)],
    compiledSectionOverrides: overrides,
    compiledContributions: compiled,
  }
  copyDerivedCrudRouteCapabilities(sections, bound)
  return bound
}
