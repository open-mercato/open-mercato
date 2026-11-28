import type { CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import {
  parseCrudFormOwnedPath, readByDotPath,
} from '../crud/form-field-paths'
import { appendLeaves, readPayloadLeaves } from '../crud/section-leaf-merge'
import { readCrudFormSectionCustomFieldValue, type CrudFormSectionCustomFields } from './crud-form-section-custom-fields'
import type { CrudFormSectionCompositionValidator, CrudFormSectionRuntime } from './crud-form-section-runtime'

type FormRecord = Record<string, unknown>
type FieldErrors = Record<string, string>

function collectSectionValues(
  values: Readonly<FormRecord>, paths: readonly string[], customKeys: ReadonlySet<string> | undefined,
  bareCustomFields: boolean,
): FormRecord | null {
  const entries = new Map<string, unknown>()
  const declared = new Set<string>()
  for (const path of paths) {
    if (!parseCrudFormOwnedPath(path) || declared.has(path)) return null
    const customKey = path.startsWith('cf_') || path.startsWith('cf:') ? path.slice(3)
      : path.startsWith('customFields.') ? path.slice('customFields.'.length)
      : bareCustomFields ? path : null
    if (path === 'customFields' || (customKey !== null && !customKeys?.has(customKey))) return null
    declared.add(path)
    const value = readByDotPath(values, path, true)
    if (value !== undefined) entries.set(path, value)
  }
  for (const key of customKeys ?? []) {
    const id = bareCustomFields ? key : `cf_${key}`
    const value = readCrudFormSectionCustomFieldValue(values, key, bareCustomFields)
    if (value !== undefined) entries.set(id, value)
  }
  const sectionValues: FormRecord = {}
  return appendLeaves(sectionValues, entries, new Set(), new Set()) ? structuredClone(sectionValues) : null
}

function ownablePayload(
  paths: Iterable<string>, ownedPaths: ReadonlySet<string>, customKeys: ReadonlySet<string> | undefined,
): boolean {
  return [...paths].every((path) => path.startsWith('customFields.')
    ? customKeys?.has(path.slice('customFields.'.length)) === true
    : ownedPaths.has(path))
}

type SubmitProjection<TPayload> =
  | { state: 'ready'; payload: Readonly<Partial<TPayload>>; activeValues: FormRecord }
  | { state: 'invalid'; fieldErrors: FieldErrors }
  | { state: 'blocked' }

export function projectCrudFormSectionSubmission<TValues extends FormRecord, TPayload extends FormRecord>({
  values, surface, descriptors, customFields, bareCustomFields, compositionValidator,
}: {
  values: TValues
  surface: CrudFormSectionSurfaceAlternativeFact
  descriptors: readonly CrudFormSectionRuntime<TValues, TPayload>[]
  customFields: CrudFormSectionCustomFields
  bareCustomFields: boolean
  compositionValidator?: CrudFormSectionCompositionValidator<TValues, TPayload>
}): SubmitProjection<TPayload> {
  try {
    const fullValues = structuredClone(values)
    const activeSectionIds = new Set(surface.orderedSectionIds)
    if (!customFields.valid || descriptors.length !== activeSectionIds.size) return { state: 'blocked' }
    const payload: Partial<TPayload> = {}
    const activeValues: FormRecord = {}
    const parsedSections = new Map<string, unknown>()
    const ownership = new Map(surface.ownershipFacts.map((owner) => [owner.sectionId, new Set(owner.payloadPaths)]))
    const allActiveFields = new Set<string>()
    const payloadPaths = new Set<string>()
    const payloadBranches = new Set<string>()
    const formPaths = new Set<string>()
    const formBranches = new Set<string>()
    const errors: FieldErrors = {}
    let invalid = false

    for (const descriptor of descriptors) {
      const id = descriptor.group.id
      const owned = ownership.get(id) ?? new Set<string>()
      const customKeys = customFields.keysBySection.get(id)
      const sectionValues = collectSectionValues(
        fullValues, descriptor.ownedFieldPaths, customKeys, bareCustomFields,
      )
      if (!sectionValues || !activeSectionIds.has(id)) return { state: 'blocked' }
      const sectionFields = new Set([
        ...descriptor.ownedFieldPaths,
        ...[...(customKeys ?? [])].map((key) => bareCustomFields ? key : `cf_${key}`),
      ])
      for (const field of sectionFields) allActiveFields.add(field)
      const result = descriptor.validateAndProject({ sectionValues: structuredClone(sectionValues), fullValues: structuredClone(fullValues) })
      if (!result.success) {
        invalid = true
        for (const [field, error] of Object.entries(result.fieldErrors)) {
          if (sectionFields.has(field)) errors[field] = error
        }
        continue
      }
      const leaves = readPayloadLeaves(result.data.payload)
      if (!leaves || !ownablePayload(leaves.keys(), owned, customKeys)
          || !appendLeaves(payload, leaves, payloadPaths, payloadBranches)) return { state: 'blocked' }
      const currentFields = new Map([...sectionFields].flatMap((field) => {
        const value = readByDotPath(sectionValues, field, true)
        return value === undefined ? [] : [[field, value] as const]
      }))
      if (!appendLeaves(activeValues, currentFields, formPaths, formBranches)) return { state: 'blocked' }
      parsedSections.set(id, result.data.parsed)
    }
    if (invalid) return { state: 'invalid', fieldErrors: errors }

    const checked = compositionValidator?.({
      activeSectionIds, parsedSections, fullValues: structuredClone(fullValues), payload: structuredClone(payload),
    })
    if (checked && !checked.success) {
      return { state: 'invalid', fieldErrors: Object.fromEntries(
        Object.entries(checked.fieldErrors).filter(([field]) => allActiveFields.has(field)),
      ) }
    }
    const composed = checked?.data ?? payload
    const leaves = readPayloadLeaves(composed)
    if (!leaves || [...leaves.keys()].some((path) => !payloadPaths.has(path))) return { state: 'blocked' }
    return { state: 'ready', payload: structuredClone(composed), activeValues }
  } catch {
    return { state: 'blocked' }
  }
}
