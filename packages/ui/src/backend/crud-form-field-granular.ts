import { z } from 'zod'
import {
  evaluateCrudFormFieldRules,
  isAbsentCrudFormFieldValue,
  normalizeCrudFormFieldRules,
  type CrudFormDeclarativeFieldConstraint,
} from '@open-mercato/shared/lib/crud/form-sections/field-rules'
import { isRecord } from '@open-mercato/shared/lib/utils'
import { symbolicIdSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import type { CrudFormSectionAddress } from '@open-mercato/shared/modules/form-section-facts'
import type { CrudFormSectionDescriptorIdentity } from '@open-mercato/shared/modules/form-sections'
import type { FieldVisibilityRule } from '@open-mercato/shared/modules/widgets/injection'
import type { CrudBuiltinField, CrudCustomField, CrudField, CrudFieldOption } from './CrudForm'
import type {
  CrudFormExtensionClientFieldRule, CrudFormExtensionFieldContext, CrudFormExtensionOption,
  CrudFormExtensionOptionSource, CrudFormExtensionAddedField,
} from './crud-form-extensions'
import { parseCrudFormOwnedPath, readByDotPath, writeByDotPath } from './crud/form-field-paths'
import { mergeCrudFormSectionFragments } from './crud/section-leaf-merge'
import {
  defineCrudFormSectionRuntime,
  type CrudFormSectionRuntime,
  type CrudFormSectionRuntimeDescriptor,
} from './injection/crud-form-section-runtime'

type FormValues = Record<string, unknown>
type Rule<TValues> = Readonly<{
  id: string
  fieldPaths: readonly string[]
  mandatory?: boolean
  check: (values: Readonly<TValues>) => Record<string, string> | null
}>
type FieldProjector<TValues> = (value: unknown, values: Readonly<TValues>) => Readonly<FormValues>
type Descriptor<TValues> = CrudFormSectionRuntimeDescriptor<TValues, ReadonlyMap<string, unknown>, FormValues>

export type CrudFormFieldGranularSectionDefinition<TValues extends FormValues> =
  Omit<Descriptor<TValues>, 'validate' | 'projectPayload' | 'ownedFieldPaths'> & {
    fields: readonly CrudField[]
    fieldSchemas: Readonly<Record<string, z.ZodType>>
    fieldPayloadPaths: Readonly<Record<string, readonly string[]>>
    refinements: readonly Rule<TValues>[]
    projectField: Readonly<Record<string, FieldProjector<TValues>>>
  }

export type CrudFormFieldGranularSection<TValues extends FormValues = FormValues> =
  CrudFormFieldGranularSectionDefinition<TValues> & Descriptor<TValues> & CrudFormSectionRuntime<TValues, FormValues>

type FieldPresentation = Readonly<{
  labelKey?: string
  readOnly?: boolean
  visibleWhen?: FieldVisibilityRule
  before?: string
  after?: string
  options?: readonly CrudFormExtensionOption[]
  rules?: readonly CrudFormDeclarativeFieldConstraint[]
}>

export type CrudFormGranularFieldOperation =
  | { operation: 'remove' }
  | { operation: 'patch'; patch: FieldPresentation }
  | { operation: 'add'; definition: FieldPresentation & { type: CrudFormExtensionAddedField['type']; required?: boolean } }

export type CrudFormPreparedField = Readonly<{
  clientRule?: CrudFormExtensionClientFieldRule
  validationPayloadPath?: string
  loadOptions?: NonNullable<CrudBuiltinField['loadOptions']>
  component?: CrudCustomField['component']
}>

function invalid(message: string): never {
  throw new Error(`[internal] Cannot derive CrudForm section: ${message}`)
}

export function createCrudFormDerivedSectionIdentity(extensionId: string, sectionId: string, revision: number): CrudFormSectionDescriptorIdentity {
  if (!symbolicIdSchema.safeParse(extensionId).success || !symbolicIdSchema.safeParse(sectionId).success
      || !Number.isSafeInteger(revision) || revision < 1) invalid('invalid derived round-trip identity')
  const id = `${extensionId}.${sectionId}`
  if (!symbolicIdSchema.safeParse(id).success) invalid('derived descriptor id exceeds its bounds')
  return { id, roundTripId: `${id}@v${revision}` }
}

export function normalizeCrudFormRefinements<TValues>(refinements: readonly Rule<TValues>[]) {
  return refinements.map(({ id, fieldPaths, mandatory, check }) => ({ id, fieldPaths, mandatory: mandatory === true, check }))
}

function ensureDistinctPaths(paths: readonly string[]): void {
  const seen = new Set(paths)
  if (seen.size !== paths.length || paths.some((path) => {
    const parts = parseCrudFormOwnedPath(path)
    return !parts || parts.slice(1).some((_, index) => seen.has(parts.slice(0, index + 1).join('.')))
  })) invalid('duplicate, invalid or overlapping field paths')
}

function createRuntime<TValues extends FormValues>(
  definition: CrudFormFieldGranularSectionDefinition<TValues>,
  checks: ReadonlyMap<string, (value: unknown, values: Readonly<TValues>) => true | string> = new Map(),
  allowEmpty = false,
): CrudFormFieldGranularSection<TValues> {
  const { fields, group, fieldSchemas, fieldPayloadPaths, projectField } = definition
  if ((!fields.length && !allowEmpty) || group.bare) invalid('a component-only group cannot publish field-granular metadata')
  const fieldIds = fields.map(({ id }) => id)
  const fieldIndex = new Set(fieldIds)
  ensureDistinctPaths(fieldIds)
  for (const map of [fieldSchemas, fieldPayloadPaths, projectField]) {
    if (Object.keys(map).length !== fields.length || fieldIds.some((id) => !Object.hasOwn(map, id))) {
      invalid('the field schema, payload ownership and projector maps must cover exactly the declared fields')
    }
  }
  ensureDistinctPaths(fieldIds.flatMap((id) => fieldPayloadPaths[id]))
  const refinements = normalizeCrudFormRefinements(definition.refinements)
  if (new Set(refinements.map(({ id }) => id)).size !== refinements.length
      || refinements.some(({ id, fieldPaths }) => !id || !fieldPaths.length
        || new Set(fieldPaths).size !== fieldPaths.length || fieldPaths.some((path) => !fieldIndex.has(path)))) {
    invalid('a refinement must name unique declared field paths')
  }
  const ownership = new Map(fieldIds.map((id) => [id, new Set(fieldPayloadPaths[id])]))
  const customKeys = fieldIds.flatMap((id) => fieldPayloadPaths[id]
    .filter((path) => path.startsWith('customFields.')).map((path) => path.slice('customFields.'.length)))
  const ownedCustomFieldIds = definition.ownedCustomFieldIds === 'all'
    ? 'all' : [...new Set([...(definition.ownedCustomFieldIds ?? []), ...customKeys])]

  const runtime = defineCrudFormSectionRuntime<TValues, ReadonlyMap<string, unknown>, FormValues>({
    ...definition, group: { ...group, fields: [...fields] }, ownedFieldPaths: fieldIds,
    ...(ownedCustomFieldIds.length ? { ownedCustomFieldIds } : {}),
    validate({ sectionValues, fullValues }) {
      const data = new Map<string, unknown>()
      const errors = new Map<string, string>()
      for (const id of fieldIds) {
        const value = fieldSchemas[id].safeParse(readByDotPath(sectionValues, id, true))
        if (!value.success) {
          errors.set(id, value.error.issues[0]?.message ?? 'ui.forms.errors.highlighted')
          continue
        }
        const message = checks.get(id)?.(value.data, fullValues)
        if (message !== undefined && message !== true) errors.set(id, message)
        data.set(id, value.data)
      }
      if (!errors.size) {
        for (const { check, fieldPaths } of refinements) {
          for (const [id, message] of Object.entries(check(fullValues) ?? {})) {
            if (fieldPaths.includes(id) && !errors.has(id)) errors.set(id, message)
          }
        }
      }
      return errors.size ? { success: false, fieldErrors: Object.fromEntries(errors) } : { success: true, data }
    },
    projectPayload(parsed, values) {
      const fragments = fieldIds.map((id) => ({ fragment: projectField[id](parsed.get(id), values), owned: ownership.get(id)! }))
      return mergeCrudFormSectionFragments(fragments) ?? invalid('field projectors emitted overlapping or unowned payload paths')
    },
  })
  return { ...definition, ...runtime, refinements }
}

export function defineCrudFormFieldGranularSection<TValues extends FormValues = FormValues>(
  definition: CrudFormFieldGranularSectionDefinition<TValues>,
): CrudFormFieldGranularSection<TValues> {
  return createRuntime(definition)
}

export function crudFormExtensionOptionsLoader(
  source: CrudFormExtensionOptionSource,
  getContext: () => CrudFormExtensionFieldContext,
): NonNullable<CrudBuiltinField['loadOptions']> {
  return async () => toFieldOptions(typeof source === 'function' ? await source(getContext()) : source)
}

function toFieldOptions(options: readonly CrudFormExtensionOption[]): CrudFieldOption[] {
  return options.map(({ value, labelKey }) => ({ value, label: labelKey, labelKey }))
}

function baseSchema(type: CrudFormExtensionAddedField['type'], required: boolean | undefined): z.ZodType {
  const requiredKey = 'ui.forms.errors.required'
  const error = (issue: { input: unknown }) => required && isAbsentCrudFormFieldValue(issue.input)
    ? requiredKey : 'ui.forms.errors.highlighted'
  const schema: z.ZodType = type === 'boolean' ? z.boolean({ error }) : type === 'number' ? z.number({ error })
    : type === 'date' ? z.iso.date({ error }) : type === 'custom' ? z.unknown() : z.string({ error })
  return required ? schema.refine((value) => !isAbsentCrudFormFieldValue(value), { error: requiredKey }) : schema.nullish()
}

function patchField(field: CrudField, patch: FieldPresentation, prepared?: CrudFormPreparedField): CrudField {
  const { labelKey, readOnly, visibleWhen, options } = patch
  if ((options || prepared?.loadOptions) && field.type !== 'select') invalid(`options on non-select field "${field.id}"`)
  const presentation = {
    ...(labelKey !== undefined ? { label: labelKey, labelKey } : {}),
    ...(readOnly !== undefined ? { readOnly } : {}),
    ...(readOnly === true && (field.type === 'checkbox' || field.type === 'custom') ? { disabled: true } : {}),
    ...(visibleWhen !== undefined ? { visibleWhen } : {}),
  }
  if (field.type === 'select' && (options || prepared?.loadOptions)) {
    return { ...field, ...presentation, options: options ? toFieldOptions(options) : undefined, loadOptions: prepared?.loadOptions }
  }
  return Object.keys(presentation).length ? { ...field, ...presentation } : field
}

function placeFields(fields: CrudField[], placements: ReadonlyMap<string, FieldPresentation>): CrudField[] {
  const index = new Map(fields.map((field) => [field.id, field]))
  const order = fields.filter(({ id }) => !placements.has(id))
  const pending = new Map(placements)
  const lastAfter = new Map<string, string>()
  while (pending.size) {
    const previousSize = pending.size
    for (const [id, { before, after }] of pending) {
      const anchor = before ?? after
      if (!anchor || (before && after) || !index.has(anchor) || anchor === id) invalid(`invalid placement for field "${id}"`)
      const neighbor = after ? lastAfter.get(after) ?? after : anchor
      const point = order.findIndex((field) => field.id === neighbor)
      if (point === -1) continue
      order.splice(point + (after ? 1 : 0), 0, index.get(id)!)
      if (after) lastAfter.set(after, id)
      pending.delete(id)
    }
    if (pending.size === previousSize) invalid('cyclic field placement')
  }
  return order
}

export function getCrudFormFieldGranularBase(host: unknown, sectionId: string): CrudFormFieldGranularSection {
  const candidates = isRecord(host) && Array.isArray(host.sectionDescriptors) ? host.sectionDescriptors : [host]
  const candidate: unknown = candidates.find((value: unknown) =>
    isRecord(value) && isRecord(value.group) && value.group.id === sectionId,
  )
  if (!isRecord(candidate) || !Array.isArray(candidate.fields) || !Array.isArray(candidate.refinements)
      || !isRecord(candidate.fieldSchemas) || !isRecord(candidate.fieldPayloadPaths) || !isRecord(candidate.projectField)
      || typeof candidate.validateAndProject !== 'function') {
    return invalid(`missing exact field-granular host section "${sectionId}"`)
  }
  return candidate as unknown as CrudFormFieldGranularSection
}

export function deriveCrudFormFieldGranularSection<TValues extends FormValues = FormValues>({
  identity, address, base, titleKey, changes, addedPayloadPaths, customFieldDefinitionSetId = base?.customFieldDefinitionSetId, prepared = {},
}: {
  identity: CrudFormSectionDescriptorIdentity
  address: CrudFormSectionAddress
  base?: CrudFormFieldGranularSection<TValues>
  titleKey?: string
  customFieldDefinitionSetId?: string
  changes: Readonly<Record<string, CrudFormGranularFieldOperation>>
  addedPayloadPaths: Readonly<Record<string, string>>
  prepared?: Readonly<Record<string, CrudFormPreparedField>>
}): CrudFormFieldGranularSection<TValues> {
  if (base && (!base.fields || base.group.id !== address.sectionId)) invalid('modify requires an exact field-granular base section')
  const fields = new Map((base?.fields ?? []).map((field) => [field.id, field]))
  const fieldSchemas = new Map(Object.entries(base?.fieldSchemas ?? {}))
  const fieldPayloadPaths = new Map(Object.entries(base?.fieldPayloadPaths ?? {}))
  const projectField = new Map(Object.entries(base?.projectField ?? {}))
  const removed = new Set<string>()
  const removedCustomFields = new Set<string>()
  const placements = new Map<string, FieldPresentation>()
  const checks = new Map<string, (value: unknown, values: Readonly<TValues>) => true | string>()
  const foundAddedBindings = new Set<string>()
  for (const [id, change] of Object.entries(changes)) {
    if (!parseCrudFormOwnedPath(id)) invalid(`invalid field id "${id}"`)
    const existing = fields.get(id)
    const hydrated = Object.hasOwn(prepared, id) ? prepared[id] : undefined
    if (change.operation === 'remove') {
      if (!existing) invalid(`unknown base field "${id}"`)
      removed.add(id)
      for (const path of fieldPayloadPaths.get(id) ?? []) {
        if (path.startsWith('customFields.')) removedCustomFields.add(path.slice('customFields.'.length))
      }
      fields.delete(id)
      fieldSchemas.delete(id)
      fieldPayloadPaths.delete(id)
      projectField.delete(id)
      continue
    }
    const presentation = change.operation === 'add' ? change.definition : change.patch
    if (change.operation === 'add') {
      if (existing) invalid(`duplicate field "${id}"`)
      const path = Object.hasOwn(addedPayloadPaths, id) ? addedPayloadPaths[id] : undefined
      if (!path || !parseCrudFormOwnedPath(path)) return invalid(`missing compiled payload path for "${id}"`)
      foundAddedBindings.add(id)
      const { type, labelKey = `${identity.id}.fields.${id}`, required } = change.definition
      const current = { id, label: labelKey, labelKey, required }
      const added: CrudField = type === 'custom'
        ? { ...current, type, component: hydrated?.component ?? invalid(`missing custom renderer for "${id}"`) }
        : { ...current, type: type === 'boolean' ? 'checkbox' : type }
      fields.set(id, patchField(added, presentation, hydrated))
      fieldSchemas.set(id, baseSchema(type, required))
      fieldPayloadPaths.set(id, [path])
      projectField.set(id, (value) => {
        const fragment: FormValues = {}
        if (value !== undefined) writeByDotPath(fragment, path, value)
        return fragment
      })
    } else {
      if (!existing) return invalid(`unknown base field "${id}"`)
      fields.set(id, patchField(existing, presentation, hydrated))
    }
    if (presentation.before !== undefined || presentation.after !== undefined) placements.set(id, presentation)
    const rules = normalizeCrudFormFieldRules(presentation.rules ?? [])
    if (rules.length || hydrated?.clientRule) {
      const paths = fieldPayloadPaths.get(id) ?? []
      const path = hydrated?.validationPayloadPath ?? (paths.length === 1 ? paths[0] : undefined)
      const clientRule = hydrated?.clientRule
      if (clientRule && (!path || !paths.includes(path))) invalid(`missing exact client-rule payload binding for "${id}"`)
      checks.set(id, (value, values) => {
        const error = evaluateCrudFormFieldRules(value, rules, 'client')
        if (error) return error
        return clientRule && path ? clientRule(value, { address, fieldId: id, payloadPath: path, values }) : true
      })
    }
  }
  if (Object.keys(addedPayloadPaths).length !== foundAddedBindings.size) invalid('unexpected compiled field payload binding')
  const refinements = base?.refinements.filter(({ id, mandatory, fieldPaths }) => {
    if (!fieldPaths.some((path) => removed.has(path))) return true
    if (mandatory) invalid(`cannot remove field required by mandatory refinement "${id}"`)
    return false
  }) ?? []
  const ownedCustom = base?.ownedCustomFieldIds
  if (ownedCustom === 'all' && removedCustomFields.size) invalid('cannot remove an individual custom field from an all-fields owner')
  const ownedCustomFieldIds = ownedCustom === 'all' ? 'all' : ownedCustom?.filter((key) => !removedCustomFields.has(key))
  return createRuntime({
    ...base, ...identity, group: { ...base?.group, id: address.sectionId, ...(titleKey !== undefined ? { title: titleKey } : {}) },
    fields: placeFields([...fields.values()], placements),
    fieldSchemas: Object.fromEntries(fieldSchemas), fieldPayloadPaths: Object.fromEntries(fieldPayloadPaths),
    projectField: Object.fromEntries(projectField), refinements, ownedCustomFieldIds, customFieldDefinitionSetId,
  }, checks, Boolean(base || titleKey))
}
