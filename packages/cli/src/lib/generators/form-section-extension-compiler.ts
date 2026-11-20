import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript-js'
import {
  applyCrudFormSectionPlacements, canonicalSectionJson, compareSectionIds, crudFormSectionHostKey,
} from '@open-mercato/shared/lib/crud/form-sections/composition'
import type { CustomFieldDefinition, CustomFieldSet } from '@open-mercato/shared/modules/entities'
import type { CompiledCrudFormAlternative, CompiledCrudFormCustomField } from '@open-mercato/shared/lib/crud/form-sections/compiled-extensions'
import type { CrudFormSectionAddress, CrudFormSectionContributionFact, CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import type { CrudFormSectionClientHostFact } from '@open-mercato/shared/modules/form-sections'
import type { FormSectionOverride, FormSectionOverridesMap } from '@open-mercato/shared/modules/overrides'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import { arrayField, exportedDeclaration, fieldsOf, literalData, literalValue, readIdentity, readSectionRuntimeFields } from './form-section-ast'
import {
  sectionSymbol, type SectionExtensionChange, type SectionExtensionField, type SectionExtensionSource, type SectionBrowserLoader,
} from './form-section-extension-source'
import { hashCompiledSectionSource } from './form-section-runtime-revisions'

const maximumAlternatives = 128
const revisionFilename = 'form-sections.revisions.json'

type Invalid = (reason: string) => never
type Ownership = CrudFormSectionSurfaceAlternativeFact['ownershipFacts'][number]
type Revision = { n: number; baseRoundTripId: string | null; patchHash: string }
type Runtime = { source: ts.SourceFile; runtimePath: string }
type Write = { filename: string; content: string }

export type CompilerModule = {
  moduleId: string
  importPath: string
  sourceBase: string
  authoredSource: boolean
  extensionSources: readonly SectionExtensionSource[]
  clientHosts: CrudFormSectionClientHostFact[]
  contributedOverrides: FormSectionOverridesMap
  runtimeSources: ReadonlyMap<string, Runtime>
  customFieldSeedEntities: ReadonlyMap<string, Readonly<Record<string, string>>>
  primitiveContributions: readonly Pick<CrudFormSectionContributionFact, 'id' | 'address' | 'operation'>[]
}
type AuthoredChange = { module: CompilerModule; extension: SectionExtensionSource; change: SectionExtensionChange }
type CompiledField = { authored: AuthoredChange; field: SectionExtensionField; payloadPath?: string; customField?: CompiledCrudFormCustomField; seed?: CustomFieldDefinition }
type CompiledChange = {
  id: string
  source: AuthoredChange
  target: Omit<CrudFormSectionAddress, 'sectionId'>
  override: FormSectionOverride
  ownership?: Ownership
  contribution: CrudFormSectionContributionFact
  file: string
  fields: CompiledField[]
  sinks: { id: string; roundTripId: string; capabilityId: string; hostDetailEntityId: string; fields: CompiledField[] }[]
  defaults: { owner: AuthoredChange; id: string; payloadPath: string; readsPayloadPaths: readonly string[] }[]
}

export type CompiledSectionExtensions = {
  contributionsByModule: ReadonlyMap<string, readonly CompiledChange[]>
  alternativesByModule: ReadonlyMap<string, readonly CompiledCrudFormAlternative[]>
  runtimeFiles: readonly { name: string; content: string }[]
  revisionWrites: readonly Write[]
  fallbacks: FormSectionOverridesMap
  customFieldSetsByModule: ReadonlyMap<string, readonly CustomFieldSet[]>
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalSectionJson(value)).digest('hex')
}

function validPath(value: string): boolean {
  return /^[a-zA-Z0-9_:-]+(?:\.[a-zA-Z0-9_:-]+)*$/.test(value)
    && !value.split('.').some((component) => ['constructor', 'prototype', '__proto__'].includes(component))
}

function readRevisions(module: CompilerModule, invalid: Invalid) {
  const filename = path.join(module.sourceBase, revisionFilename)
  const stats = fs.lstatSync(filename, { throwIfNoEntry: false })
  const original = stats?.isFile() ? fs.readFileSync(filename, 'utf8') : ''
  let values: unknown
  try { values = original ? JSON.parse(original) : {} } catch { return invalid(`invalid ${revisionFilename}`) }
  if ((stats && !stats.isFile()) || !values || typeof values !== 'object' || Array.isArray(values)) return invalid(`invalid ${revisionFilename}`)
  const revisions = new Map<string, Revision>()
  for (const [id, value] of Object.entries(values)) {
    if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.n) || value.n < 1
        || (value.baseRoundTripId !== null && typeof value.baseRoundTripId !== 'string')
        || typeof value.patchHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.patchHash)) {
      return invalid(`invalid revision for "${id}" in ${revisionFilename}`)
    }
    revisions.set(id, value)
  }
  return { filename, original, revisions }
}

function runtimeFields(runtime: Runtime, invalid: Invalid) {
  const initializer = exportedDeclaration(runtime.source, 'crudFormSectionRuntime')
  if (!initializer) return invalid('missing crudFormSectionRuntime')
  return readSectionRuntimeFields(initializer, runtime.source, invalid)
}

function granularFields(base: Map<string, ts.Expression>, invalid: Invalid): Map<string, string[]> {
  const paths = base.get('fieldPayloadPaths')
  if (!paths || !base.has('fieldSchemas') || !base.has('projectField')) return invalid('modify requires a field-granular base descriptor')
  return new Map([...fieldsOf(paths, invalid)].map(([field, entry]) => {
    const values = literalData(entry, invalid)
    if (!Array.isArray(values) || values.some((value: unknown) => typeof value !== 'string' || !validPath(value))) {
      return invalid(`invalid payload paths for base field "${field}"`)
    }
    return [field, values as string[]]
  }))
}

function baseDescriptor(runtime: Runtime, sectionId: string, invalid: Invalid) {
  const fields = runtimeFields(runtime, invalid)
  const section = (fields.has('sectionDescriptors')
    ? arrayField(fields, 'sectionDescriptors', invalid).map((entry) => readSectionRuntimeFields(entry, runtime.source, invalid))
    : [fields]).find((entry) => {
      const group = entry.get('group')
      return group && literalData(fieldsOf(group, invalid).get('id')!, invalid) === sectionId
    })
  if (!section) return invalid(`host did not publish a runtime descriptor for section "${sectionId}"`)
  return section
}

function exactPaths(values: readonly string[]) {
  return [...values].sort(compareSectionIds)
}

function matchingPaths(left: readonly string[], right: readonly string[]): boolean {
  return canonicalSectionJson(exactPaths(left)) === canonicalSectionJson(exactPaths(right))
}

function pathsOverlap(paths: readonly string[]): boolean {
  const ordered = exactPaths(paths)
  return ordered.some((entry, index) => ordered.slice(index + 1).some((other) => other === entry || other.startsWith(entry + '.')))
}

function explicitPlacement(change: SectionExtensionChange): FormSectionOverride & { operation: 'add' } {
  const relativeTo = change.before ?? change.after
  const position = change.before ? InjectionPosition.Before : change.after ? InjectionPosition.After : InjectionPosition.Last
  return { operation: 'add', contributionId: '', ...(relativeTo ? { placement: { relativeTo, position } } : {}) }
}

function overrideKey({ hostId, formVariant, formOperation, sectionId }: CrudFormSectionAddress) {
  return [hostId, formVariant, formOperation, sectionId].join('/')
}

function renderBrowserRuntime(candidate: CompiledChange, hostRuntime: Runtime, customDefinitionSet: string | undefined): string {
  const { contribution, source, fields } = candidate
  const identity = { id: contribution.id, roundTripId: contribution.roundTripId }
  const { change } = source
  const output = ['// Auto-generated by yarn generate. Do not edit.']
  if (change.operation === 'hide') return [...output, `export const crudFormSectionRuntime = ${JSON.stringify(identity)} as const`, ''].join('\n')
  if (change.replacement) {
    return [...output,
      `import { crudFormSectionRuntime as replacement } from ${JSON.stringify(change.replacement.importPath)}`,
      `export const crudFormSectionRuntime = { ...replacement, ...${JSON.stringify(identity)} }`, '',
    ].join('\n')
  }
  const helpers = [
    'deriveCrudFormFieldGranularSection',
    ...(change.operation === 'modify' ? ['getCrudFormFieldGranularBase'] : []),
    ...(fields.some(({ field }) => field.loaders.options) ? ['crudFormExtensionOptionsLoader'] : []),
  ]
  output.push(`import { ${helpers.join(', ')} } from '@open-mercato/ui/backend/crud-form-field-granular'`)
  if (change.operation === 'modify') {
    output.push(`import { crudFormSectionRuntime as hostRuntime } from ${JSON.stringify(hostRuntime.runtimePath)}`)
    output.push(`const base = getCrudFormFieldGranularBase(hostRuntime, ${JSON.stringify(change.id)})`)
  }
  const imports: string[] = []
  const prepared: string[] = []
  const address = JSON.stringify(contribution.address)
  for (const [index, item] of fields.entries()) {
    const { field, payloadPath } = item
    const settings: string[] = []
    for (const [kind, loader] of Object.entries(field.loaders)) {
      const variable = `field${index}${kind}`
      imports.push(`import ${variable} from ${JSON.stringify((loader as SectionBrowserLoader).importPath)}`)
      if (kind === 'options') settings.push(`loadOptions: crudFormExtensionOptionsLoader(${variable}, () => ({ address: ${address}, fieldId: ${JSON.stringify(field.id)}, payloadPath: ${JSON.stringify(payloadPath)}, values: {} }))`)
      else settings.push(`${kind}: ${variable}`)
    }
    if (field.loaders.clientRule) settings.push(`validationPayloadPath: ${JSON.stringify(payloadPath)}`)
    if (settings.length) prepared.push(`${JSON.stringify(field.id)}: { ${settings.join(', ')} }`)
  }
  output.push(...imports)
  const changes = Object.fromEntries(fields.map(({ field }) => [field.id, field.operation === 'remove' ? { operation: 'remove' }
    : { operation: field.operation, [field.operation === 'add' ? 'definition' : 'patch']: field.browser }]))
  const added = Object.fromEntries(fields.filter(({ field }) => field.operation === 'add').map(({ field, payloadPath }) => [field.id, payloadPath]))
  output.push('export const crudFormSectionRuntime = deriveCrudFormFieldGranularSection({',
    `  identity: ${JSON.stringify(identity)}, address: ${address},`,
    ...(change.operation === 'modify' ? ['  base,'] : []),
    ...(change.titleKey ? [`  titleKey: ${JSON.stringify(change.titleKey)},`] : []),
    ...(customDefinitionSet ? [`  customFieldDefinitionSetId: ${JSON.stringify(customDefinitionSet)},`] : []),
    `  changes: ${JSON.stringify(changes)}, addedPayloadPaths: ${JSON.stringify(added)},`,
    `  prepared: { ${prepared.join(', ')} },`, '})', '')
  return output.join('\n')
}

function surfaceKey(surface: CrudFormSectionSurfaceAlternativeFact): string | null {
  return surface.hostId === null ? null : crudFormSectionHostKey({ ...surface, hostId: surface.hostId })
}

function chooseProof(host: CrudFormSectionClientHostFact, baseline: CrudFormSectionSurfaceAlternativeFact) {
  if (baseline.clientMutationSurfaces?.some(({ kind }) => kind === 'parent-submit')) return baseline
  const proofs = host.alternatives.filter((surface) => surfaceKey(surface) === surfaceKey(baseline)
    && surface.clientMutationSurfaces?.some(({ kind }) => kind === 'parent-submit'))
  const signatures = new Set(proofs.map(({ clientMutationSurfaces }) => canonicalSectionJson(clientMutationSurfaces)))
  return signatures.size === 1 ? proofs[0] : undefined
}

export function compileCrudFormSectionExtensions(
  modules: readonly CompilerModule[], configured: Readonly<FormSectionOverridesMap>,
): CompiledSectionExtensions {
  const contributionsByModule = new Map<string, CompiledChange[]>()
  const alternativesByModule = new Map<string, CompiledCrudFormAlternative[]>()
  const runtimeFiles: { name: string; content: string }[] = []
  const ledgers = new Map<string, ReturnType<typeof readRevisions>>()
  const fallbacks: FormSectionOverridesMap = {}
  const primitiveOverrides = Object.assign({}, ...modules.map(({ contributedOverrides }) => contributedOverrides)) as FormSectionOverridesMap
  const primitiveClaims = new Map(modules.flatMap(({ primitiveContributions }) =>
    primitiveContributions.map((fact) => [fact.id, fact] as const)))
  const ids = new Set<string>()
  const extensionIds = new Set<string>()
  const seeds = new Map<string, { moduleId: string; entity: string; field: CustomFieldDefinition }>()
  const tuples = new Map<string, { target: CompiledChange['target']; changes: AuthoredChange[] }>()
  const diagnostics = (module: CompilerModule, reason: string): never => {
    throw new Error(`[generate] crudFormExtensions for "${module.moduleId}" (${module.sourceBase}): ${reason}`)
  }
  for (const module of modules) for (const extension of module.extensionSources) {
    if (extensionIds.has(extension.id)) diagnostics(module, `duplicate extension id "${extension.id}"`)
    extensionIds.add(extension.id)
    for (const target of extension.targets) {
      const address = { hostId: extension.hostId, ...target }
      const key = crudFormSectionHostKey(address)
      const current = tuples.get(key) ?? { target: address, changes: [] }
      current.changes.push(...extension.changes.map((change) => ({ module, extension, change })))
      tuples.set(key, current)
    }
  }
  for (const [key, { target, changes }] of [...tuples.entries()].sort(([left], [right]) => compareSectionIds(left, right))) {
    const invalid: Invalid = (reason) => diagnostics(changes[0].module, reason)
    const matches = modules.flatMap((module) => module.clientHosts.flatMap((host) => host.alternatives
      .filter((surface) => !surface.contributionIds.length && surfaceKey(surface) === key)
      .map((baseline) => ({ module, host, baseline }))))
    if (matches.length !== 1) return invalid(`expected one published host and baseline for ${key}`)
    const [{ module: hostModule, host, baseline }] = matches
    const runtime = hostModule.runtimeSources.get(host.id)
    const seedEntities = hostModule.customFieldSeedEntities.get(host.id) ?? {}
    if (!runtime) return invalid(`host runtime missing for ${key}`)
    const needsMutation = changes.some(({ change }) => change.operation !== 'add' || change.fields.length > 0)
    const proof = needsMutation ? chooseProof(host, baseline) : baseline
    if (!proof) return invalid(`host ${key} has no unambiguous parent-submit façade proof`)
    const mutationIds = proof.clientMutationSurfaces?.filter(({ kind, requestOperation }) =>
      kind === 'parent-submit' && requestOperation === target.formOperation).map(({ id }) => id) ?? []
    if (needsMutation && mutationIds.length !== 1) return invalid(`host ${key} requires one exact parent-submit surface`)
    const groups = new Map<string, AuthoredChange[]>()
    for (const authored of changes) {
      const { change } = authored
      const owners = groups.get(change.id) ?? []
      owners.push(authored)
      groups.set(change.id, owners)
    }

    function compile(source: AuthoredChange, members: readonly AuthoredChange[], declarationId: string): CompiledChange {
      const { module, change } = source
      const invalid: Invalid = (reason) => diagnostics(module, reason)
      const id = sectionSymbol(declarationId, 'derived descriptor ID', invalid)
      if (ids.has(id)) invalid(`duplicate derived section "${id}"`)
      ids.add(id)
      const address = { ...target, sectionId: change.id }
      if (baseline.orderedSectionIds.includes(change.id) === (change.operation === 'add')) invalid(`invalid section target "${change.id}" for "${id}"`)
      const ownership = baseline.ownershipFacts.find(({ sectionId }) => sectionId === change.id)
      const base = change.operation === 'add' ? undefined : baseDescriptor(runtime!, change.id, invalid)
      const baseRoundTripId = base ? readIdentity(base, invalid).roundTripId : null
      let descriptor = base
      const standardPaths = new Set(ownership?.payloadPaths)
      const authoredCustom = ownership?.customFieldOwnership ?? { mode: 'none' }
      const customKeys = new Set(authoredCustom.mode === 'ids' ? authoredCustom.ids : [])
      const customDefinitionSets = new Set(baseline.ownershipFacts.flatMap(({ customFieldOwnership }) =>
        customFieldOwnership.mode !== 'none' && customFieldOwnership.definitionSetId ? [customFieldOwnership.definitionSetId] : []))
      const definitionSet = authoredCustom.mode !== 'none' && authoredCustom.definitionSetId
        ? authoredCustom.definitionSetId : customDefinitionSets.size === 1 ? [...customDefinitionSets][0]
          : Object.keys(seedEntities).length === 1 ? Object.keys(seedEntities)[0] : undefined
      const byField = change.operation === 'modify' && base ? granularFields(base, invalid) : new Map<string, string[]>()
      if (byField.size && (!matchingPaths([...byField.values()].flat().filter((leaf) => !leaf.startsWith('customFields.')), [...standardPaths])
          || [...byField.values()].flat().some((leaf) => leaf.startsWith('customFields.') && !customKeys.has(leaf.slice('customFields.'.length))))) {
        return invalid(`granular section "${change.id}" diverges from published payload ownership`)
      }
      const changedFields = members.flatMap((authored): CompiledField[] => authored.change.fields.map((field) => ({ field, authored })))
      const removed = new Set(changedFields.filter(({ field }) => field.operation === 'remove').map(({ field }) => field.id))
      if (base && removed.size) for (const entry of arrayField(base, 'refinements', invalid)) {
        const refinement = fieldsOf(entry, invalid)
        const mandatory = refinement.get('mandatory')
        if (!mandatory || literalData(mandatory, invalid) !== true) continue
        if (arrayField(refinement, 'fieldPaths', invalid).some((field) => removed.has(literalValue(field, 'refinement field', invalid)))) {
          invalid(`removal intersects mandatory refinement "${literalValue(refinement.get('id'), 'refinement id', invalid)}"`)
        }
      }
      if (change.replacement) {
        const alternate = runtimeFields({ source: change.replacement.source, runtimePath: change.replacement.importPath }, invalid)
        descriptor = alternate
        const group = alternate.get('group')
        if (!group || literalValue(fieldsOf(group, invalid).get('id'), 'replacement group', invalid) !== change.id) invalid('replacement group does not match the base section')
        const ownedPaths = alternate.get('ownedPayloadPaths') ?? alternate.get('ownedFieldPaths')
        const alternativePaths = alternate.has('fieldPayloadPaths') ? [...granularFields(alternate, invalid).values()].flat()
          : ownedPaths ? literalData(ownedPaths, invalid) : undefined
        if (!Array.isArray(alternativePaths) || !matchingPaths(alternativePaths.filter((leaf) => typeof leaf === 'string' && !leaf.startsWith('customFields.')), [...standardPaths])) {
          invalid(`replacement must preserve exact payload ownership for "${change.id}"`)
        }
        const custom = alternate.get('ownedCustomFieldIds')
        const keys = custom ? literalData(custom, invalid) : []
        const replacementSet = alternate.get('customFieldDefinitionSetId')
        if ((authoredCustom.mode !== 'none' && authoredCustom.definitionSetId !== (replacementSet && literalData(replacementSet, invalid)))
            || (authoredCustom.mode === 'all' ? keys !== 'all' : !Array.isArray(keys) || !matchingPaths(keys, [...customKeys]))) {
          invalid(`replacement must preserve exact custom-field ownership for "${change.id}"`)
        }
      }
      for (const item of changedFields) {
        const { field, authored } = item
        const prior = byField.get(field.id)
        if (field.operation === 'add') {
          if (prior) invalid(`field "${field.id}" is already declared`)
          if (!validPath(field.id)) invalid(`invalid added payload key "${field.id}"`)
          const store = field.store!
          if (store.kind === 'customField') {
            if (!definitionSet || authoredCustom.mode === 'all') invalid(`custom field "${field.id}" requires a bounded host definition set`)
            const fieldKey = store.key ?? field.id
            if (!/^[a-z0-9_]{1,100}$/.test(fieldKey) || customKeys.has(fieldKey)) invalid(`invalid or duplicate snake_case custom field "${fieldKey}"`)
            const entityId = definitionSet && Object.hasOwn(seedEntities, definitionSet) ? seedEntities[definitionSet] : undefined
            if (!entityId || !definitionSet) return invalid(`custom field "${field.id}" needs a published host customFieldSeedEntities binding`)
            const type = field.browser.type
            const kind = type === 'number' ? 'float' : type === 'textarea' ? 'multiline' : type
            if (kind !== 'text' && kind !== 'multiline' && kind !== 'float' && kind !== 'boolean' && kind !== 'date' && kind !== 'select') {
              return invalid(`custom field "${field.id}" requires a supported custom-field kind`)
            }
            const options = field.browser.options
            if (kind === 'select' && (!Array.isArray(options) || !options.length || field.loaders.options
                || options.some((entry) => !entry || typeof entry.value !== 'string' || typeof entry.labelKey !== 'string'))) {
              return invalid(`custom-field select "${field.id}" requires literal options and label keys`)
            }
            const label = typeof field.browser.labelKey === 'string' ? field.browser.labelKey : `${id}.fields.${field.id}`
            item.customField = { definitionSetId: definitionSet, entityId, key: fieldKey, kind }
            item.seed = { key: fieldKey, kind, label, required: field.browser.required === true, formEditable: true,
              ...(kind === 'select' && Array.isArray(options) ? { options: options.map(({ value, labelKey }) => ({ value, label: labelKey })) } : {}) }
            customKeys.add(fieldKey)
            item.payloadPath = `customFields.${fieldKey}`
          } else {
            if (!store.entityId?.startsWith(authored.module.moduleId + ':')) invalid(`store target "${store.entityId}" must be owned by "${authored.module.moduleId}"`)
            if (field.id.includes('.') || !validPath(authored.module.moduleId)) invalid('extension sink keys must be literal single segments')
            item.payloadPath = `extensions.${authored.module.moduleId}.${field.id}`
            if (standardPaths.has(item.payloadPath)) invalid(`duplicate payload path "${item.payloadPath}"`)
            standardPaths.add(item.payloadPath)
          }
        } else {
          if (!prior) return invalid(`unknown base field "${field.id}"`)
          if (field.operation === 'remove') for (const leaf of prior) {
            if (leaf.startsWith('customFields.')) customKeys.delete(leaf.slice('customFields.'.length))
            else standardPaths.delete(leaf)
          }
          if (field.loaders.clientRule || field.loaders.options || field.server || field.rules.some(({ enforce }) => enforce === 'client-and-server')) {
            if (prior.length !== 1) invalid(`field "${field.id}" needs one exact rule or option payload path`)
            item.payloadPath = prior[0]
          }
        }
      }
      const resultOwnership: Ownership | undefined = change.operation === 'hide' ? undefined : {
        sectionId: change.id, payloadPaths: exactPaths([...standardPaths]),
        customFieldOwnership: authoredCustom.mode === 'all' ? authoredCustom : customKeys.size
          ? { mode: 'ids', ids: exactPaths([...customKeys]), ...(definitionSet ? { definitionSetId: definitionSet } : {}) } : { mode: 'none' },
      }
      const baseSyntax = base?.get('group')?.parent.parent
      const patchHash = digest({
        base: baseSyntax && ts.isObjectLiteralExpression(baseSyntax) ? hashCompiledSectionSource(baseSyntax, hostModule.sourceBase) : null,
        changes: members.map(({ module: owner, extension, change: changed }) => ({
          module: owner.moduleId,
          source: hashCompiledSectionSource(changed.syntax, owner.sourceBase),
          defaults: extension.defaults.map(({ syntax }) => hashCompiledSectionSource(syntax, owner.sourceBase)),
          replacement: changed.replacement ? hashCompiledSectionSource(exportedDeclaration(changed.replacement.source, 'crudFormSectionRuntime')!, owner.sourceBase) : null,
        })),
      })
      const ledger = ledgers.get(module.moduleId) ?? readRevisions(module, invalid)
      ledgers.set(module.moduleId, ledger)
      const previous = ledger.revisions.get(id)
      if (!module.authoredSource && (!previous || previous.baseRoundTripId !== baseRoundTripId)) {
        return invalid('packaged extension requires its reviewed revision ledger and a matching base revision')
      }
      const current = previous && (!module.authoredSource || (previous.baseRoundTripId === baseRoundTripId && previous.patchHash === patchHash))
        ? previous : { n: (previous?.n ?? 0) + 1, baseRoundTripId, patchHash }
      if (!Number.isSafeInteger(current.n)) invalid('descriptor revision exhausted')
      ledger.revisions.set(id, current)
      const roundTripId = `${id}@v${current.n}`
      const operation = change.operation === 'modify' ? 'replace' : change.operation
      const file = `crud-form-section-extension-${digest(id).slice(0, 20)}.generated.ts`
      const sinkGroups = new Map<string, CompiledField[]>()
      for (const item of changedFields) {
        const { authored, field } = item
        if (!field.store || field.store.kind === 'customField') continue
        const key = canonicalSectionJson([authored.module.moduleId,
          field.store.kind === 'table' ? field.store.entityId : authored.extension.id,
          field.store.kind === 'table' ? null : field.store.fieldOverride ? field.id : null])
        const group = sinkGroups.get(key) ?? []
        group.push(item)
        sinkGroups.set(key, group)
      }
      const sinks = [...sinkGroups.entries()].map(([key, group]) => {
        const sinkId = `${id}.sink-${digest(key).slice(0, 12)}`
        if (!host.hostResourceKind) return invalid('sink requires an exact host detail resource')
        return { id: sinkId, roundTripId: `${sinkId}@v${current.n}`, capabilityId: `${sinkId}.capability`,
          hostDetailEntityId: host.hostResourceKind, fields: group }
      })
      const displayOnly = change.operation === 'add' && !changedFields.length
      const requiredSectionIds = descriptor && operation !== 'hide'
        ? arrayField(descriptor, 'requiredSectionIds', invalid).map((entry) => literalValue(entry, 'required section id', invalid)) : []
      const requiredDataContractIds = descriptor && operation !== 'hide'
        ? arrayField(descriptor, 'requiredDataContractIds', invalid).map((entry) => literalValue(entry, 'required data contract id', invalid)) : []
      const contribution: CrudFormSectionContributionFact = {
        id, address, operation, roundTripId,
        ...(requiredSectionIds.length ? { requiredSectionIds } : {}),
        ...(requiredDataContractIds.length ? { requiredDataContractIds } : {}),
        requiredCapabilities: [{ capabilityId: `${id}.compiled`, protocol: 'crud-form-sections/v1',
          modes: displayOnly ? ['display-only'] : ['domain-adapter'], mutationSurfaceIds: displayOnly ? [] : mutationIds,
          payloadPaths: (resultOwnership?.payloadPaths ?? []).filter((path) => !path.startsWith('extensions.')),
          customFieldOwnership: resultOwnership?.customFieldOwnership ?? { mode: 'none' } },
        ...sinks.map(({ capabilityId, fields }): CrudFormSectionContributionFact['requiredCapabilities'][number] => ({
          capabilityId, protocol: 'crud-form-sections/v1', modes: ['extension-sink'], mutationSurfaceIds: mutationIds,
          payloadPaths: fields.map(({ payloadPath }) => payloadPath!), allowAfterCommitSink: true,
        }))],
      }
      const dropped = (ownership?.payloadPaths ?? []).filter((leaf) => !resultOwnership?.payloadPaths.includes(leaf))
      const defaults = members.flatMap((owner) => owner.extension.defaults.filter(({ payloadPath }) => dropped.includes(payloadPath)).map(({ payloadPath, readsPayloadPaths }) => ({
        owner, payloadPath, readsPayloadPaths, id: `${id}.default-${digest(payloadPath).slice(0, 12)}`,
      })))
      const override: FormSectionOverride = change.operation === 'add'
        ? { ...explicitPlacement(change), contributionId: id } : { operation: operation as 'hide' | 'replace', contributionId: id }
      const result: CompiledChange = { id, source, target, override, ownership: displayOnly ? undefined : resultOwnership, contribution, file, defaults, sinks, fields: changedFields }
      const moduleContributions = contributionsByModule.get(module.moduleId) ?? []
      moduleContributions.push(result)
      contributionsByModule.set(module.moduleId, moduleContributions)
      runtimeFiles.push({ name: file, content: renderBrowserRuntime(result, runtime!, definitionSet) })
      return result
    }

    const published = host.alternatives.filter((surface) => surfaceKey(surface) === key)
    const selections: CompiledChange[][] = []
    const effective: CompiledChange[] = []
    for (const [sectionId, authors] of [...groups.entries()].sort(([left], [right]) => compareSectionIds(left, right))) {
      authors.sort((left, right) => compareSectionIds(left.module.moduleId, right.module.moduleId))
      const alternatives = authors.map((author) => {
        const extensionId = author.extension.targets.length === 1 ? author.extension.id
          : `${author.extension.id}.${target.formVariant}.${target.formOperation}`
        return compile(author, [author], `${extensionId}.${sectionId}`)
      })
      const fieldIds = authors.flatMap(({ change }) => change.fields.map(({ id }) => id))
      const addedLeaves = alternatives.flatMap(({ fields }) => fields.flatMap(({ field, payloadPath }) =>
        field.operation === 'add' && payloadPath ? [payloadPath] : []))
      const canCompose = authors.length > 1 && authors.every(({ change }) => change.operation === 'modify')
        && new Set(fieldIds).size === fieldIds.length && !pathsOverlap(addedLeaves)
      const first = authors[0]
      const fallback = canCompose
        ? compile(first, authors, `${first.extension.id}.combined-${digest(alternatives.map(({ id }) => id)).slice(0, 12)}.${sectionId}`)
        : alternatives.length === 1 ? alternatives[0] : undefined
      const canonicalKey = overrideKey({ ...target, sectionId })
      const authoredResolutions = configured[canonicalKey]
      const explicit = Object.hasOwn(configured, canonicalKey)
      const choices = fallback && canCompose ? [...alternatives, fallback] : alternatives
      selections.push(choices)
      const choice = explicit
        ? authoredResolutions && choices.find(({ override }) => override.contributionId === authoredResolutions.contributionId
          && override.operation === authoredResolutions.operation)
        : fallback
      const selectedPrimitive = authoredResolutions
        ? primitiveClaims.get(authoredResolutions.contributionId) : undefined
      const selectsPrimitive = selectedPrimitive && overrideKey(selectedPrimitive.address) === canonicalKey
        && selectedPrimitive.operation === authoredResolutions?.operation
      if ((explicit && authoredResolutions && !choice && !selectsPrimitive) || (!explicit && !choice)) {
        invalid(`conflicting form section "${canonicalKey}" from ${authors.map(({ module }) => module.moduleId).join(', ')} requires an exact modules.ts selector or null`)
      }
      if (fallback) fallbacks[canonicalKey] = fallback.override
      if (choice) effective.push(choice)
    }

    for (const candidate of effective) for (const { customField, seed, authored } of candidate.fields) {
      if (!customField || !seed) continue
      const identity = canonicalSectionJson([customField.entityId, customField.key])
      const previous = seeds.get(identity)
      if (previous && (previous.moduleId !== authored.module.moduleId || canonicalSectionJson(previous.field) !== canonicalSectionJson(seed))) {
        invalid(`conflicting custom field seed "${customField.entityId}/${customField.key}" from ${previous.moduleId} and ${authored.module.moduleId}`)
      }
      seeds.set(identity, { moduleId: authored.module.moduleId, entity: customField.entityId, field: seed })
    }

    const effectiveDefaultKeys = new Set<string>()
    for (const candidate of effective) for (const value of candidate.defaults) {
      if (effectiveDefaultKeys.has(value.payloadPath)) invalid(`conflicting default for "${value.payloadPath}" in ${key}`)
      effectiveDefaultKeys.add(value.payloadPath)
    }
    for (const { extension } of changes) for (const { payloadPath: leaf } of extension.defaults) {
      if (!selections.flat().some(({ defaults }) => defaults.some(({ owner, payloadPath }) => owner.extension === extension && payloadPath === leaf))) {
        invalid(`default "${leaf}" is not bound to an omitted leaf of ${key}`)
      }
    }
    const numberOfSelections = selections.reduce((total, choices) => total * (choices.length + 1), published.length)
    if (numberOfSelections > maximumAlternatives) invalid(`host ${key} exceeds the ${maximumAlternatives} finite alternative limit (${numberOfSelections})`)
    const generated = alternativesByModule.get(hostModule.moduleId) ?? []
    const emitted = new Set<string>()
    function addAlternative(
      chosen: readonly CompiledChange[], original: CrudFormSectionSurfaceAlternativeFact,
      manual: ReadonlyMap<string, FormSectionOverride>, effectiveSelection = false,
    ): boolean {
      if (!chosen.length) return true
      if (chosen.some(({ contribution }) => manual.has(contribution.address.sectionId))) return false
      const overrides = new Map([...manual, ...chosen.map(({ contribution, override }) => [contribution.address.sectionId,
        effectiveSelection && configured[overrideKey(contribution.address)] || override] as const)])
      const orderedSectionIds = applyCrudFormSectionPlacements(baseline.orderedSectionIds, overrides)
      const active = new Map(original.ownershipFacts.map((item) => [item.sectionId, item]))
      for (const { ownership, contribution } of chosen) {
        if (ownership) active.set(ownership.sectionId, ownership)
        else active.delete(contribution.address.sectionId)
      }
      const ownershipFacts = [...active.values()]
      const custom = ownershipFacts.flatMap(({ customFieldOwnership }, index) => customFieldOwnership.mode === 'ids'
        ? customFieldOwnership.ids.map((id) => `customFields.${id}`)
        : customFieldOwnership.mode === 'all' ? [`customFields\u0000${index}`] : [])
      const rules = chosen.flatMap(({ defaults }) => defaults)
      const genericTableTargets = chosen.flatMap(({ sinks }) => sinks.flatMap(({ fields }) =>
        fields[0].field.store?.kind === 'table' ? [fields[0].field.store.entityId] : []))
      if (new Set(genericTableTargets).size !== genericTableTargets.length) return false
      if (!orderedSectionIds || chosen.some(({ contribution }) => contribution.requiredSectionIds
          ?.some((sectionId) => !orderedSectionIds.includes(sectionId)))
          || pathsOverlap([...ownershipFacts.flatMap(({ payloadPaths }) => payloadPaths), ...custom])
          || (custom.some((name) => name.startsWith('customFields\u0000')) && custom.length > 1)
          || new Set(rules.map(({ payloadPath }) => payloadPath)).size !== rules.length
          || rules.some(({ readsPayloadPaths }) => readsPayloadPaths.some((path) =>
            !ownershipFacts.some(({ payloadPaths }) => payloadPaths.includes(path))))) return false
      const contributionIds = [...original.contributionIds, ...chosen.map(({ id }) => id)].sort(compareSectionIds)
      const signature = canonicalSectionJson(contributionIds)
      if (emitted.has(signature)) return true
      emitted.add(signature)
      const selectedProof = original.clientMutationSurfaces?.some(({ kind }) => kind === 'parent-submit') ? original : proof!
      if (mutationIds.some((id) => !selectedProof.mutationSurfaceIds.includes(id))) return false
      const surface = {
        ...original, id: `${baseline.id}.compiled-${digest(contributionIds).slice(0, 12)}`,
        orderedSectionIds, contributionIds, ownershipFacts, mutationSurfaceIds: selectedProof.mutationSurfaceIds,
        clientMutationSurfaces: selectedProof.clientMutationSurfaces,
        dependencies: [...original.dependencies, ...chosen.flatMap(({ contribution }) => {
          const { id, requiredSectionIds = [], requiredDataContractIds = [] } = contribution
          return requiredSectionIds.length || requiredDataContractIds.length
            ? [{ consumerContributionId: id, requiredSectionIds, requiredDataContractIds }] : []
        })],
      }
      generated.push({ hostDescriptorId: host.id, proofAlternativeId: selectedProof.id, surface, defaultProviders: rules.map(({ id, payloadPath }) => ({ id, payloadPath })) })
      host.alternatives = [...host.alternatives, surface]
      return true
    }
    function manualOverrides(original: CrudFormSectionSurfaceAlternativeFact): Map<string, FormSectionOverride> | null {
      const result = new Map<string, FormSectionOverride>()
      for (const id of original.contributionIds) {
        const claim = primitiveClaims.get(id)
        if (!claim || crudFormSectionHostKey(claim.address) !== key || result.has(claim.address.sectionId)) return null
        const address = overrideKey(claim.address)
        const configuredChoice = configured[address]
        const contributedChoice = primitiveOverrides[address]
        const selector = configuredChoice?.contributionId === id ? configuredChoice
          : contributedChoice?.contributionId === id ? contributedChoice
          : claim.operation === 'add' ? undefined : { operation: claim.operation, contributionId: id }
        if (!selector || selector.operation !== claim.operation) return null
        result.set(claim.address.sectionId, selector)
      }
      return canonicalSectionJson(applyCrudFormSectionPlacements(baseline.orderedSectionIds, result))
        === canonicalSectionJson(original.orderedSectionIds) ? result : null
    }
    const rawEffective = { ...primitiveOverrides, ...fallbacks, ...configured }
    const effectiveManual = Object.entries(rawEffective).flatMap(([address, override]) => {
      const claim = override && primitiveClaims.get(override.contributionId)
      return claim && crudFormSectionHostKey(claim.address) === key && overrideKey(claim.address) === address ? [claim.id] : []
    }).sort(compareSectionIds)
    const effectiveOriginal = published.find(({ contributionIds }) =>
      canonicalSectionJson([...contributionIds].sort(compareSectionIds)) === canonicalSectionJson(effectiveManual))
    const manual = effectiveOriginal && manualOverrides(effectiveOriginal)
    if (effective.length && (!effectiveOriginal || !manual || !addAlternative(effective, effectiveOriginal, manual, true))) {
      invalid(`effective alternatives for ${key} have conflicting fields, defaults, placement or unpublished handwritten contributions`)
    }
    for (const original of published) {
      const manual = manualOverrides(original)
      if (!manual) continue
      function walk(index: number, chosen: CompiledChange[]) {
        if (index === selections.length) {
          addAlternative(chosen, original, manual!)
          return
        }
        walk(index + 1, chosen)
        for (const candidate of selections[index]) walk(index + 1, [...chosen, candidate])
      }
      walk(0, [])
    }
    alternativesByModule.set(hostModule.moduleId, generated)
  }
  const revisionWrites = [...ledgers].flatMap(([moduleId, ledger]) => {
    const module = modules.find((entry) => entry.moduleId === moduleId)!
    const content = JSON.stringify(Object.fromEntries([...ledger.revisions.keys()].sort(compareSectionIds).map((id) => [id, ledger.revisions.get(id)])), null, 2) + '\n'
    return module.authoredSource && content !== ledger.original ? [{ filename: ledger.filename, content }] : []
  })
  const customFieldSetsByModule = new Map<string, CustomFieldSet[]>()
  for (const { moduleId, entity, field } of seeds.values()) {
    const sets = customFieldSetsByModule.get(moduleId) ?? []
    const existing = sets.find((entry) => entry.entity === entity)
    if (existing) existing.fields.push(field)
    else sets.push({ entity, fields: [field], source: moduleId })
    customFieldSetsByModule.set(moduleId, sets)
  }
  return { contributionsByModule, alternativesByModule, runtimeFiles, revisionWrites, fallbacks, customFieldSetsByModule }
}
