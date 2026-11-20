import type { CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import {
  isProtoPollutingKey, parseCrudFormOwnedPath, readByDotPath, writeByDotPath,
} from '../crud/form-field-paths'
import { readCrudFormSectionCustomFieldValue, type CrudFormSectionCustomFields } from './crud-form-section-custom-fields'
import type { CrudFormSectionCompositionValidator, CrudFormSectionRuntime } from './crud-form-section-runtime'

type FormRecord = Record<string, unknown>
type FieldErrors = Record<string, string>

function isPlainRecord(value: unknown): value is FormRecord {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function isPayloadValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (value instanceof Date) return Number.isFinite(value.getTime())
  if (!(Array.isArray(value) || isPlainRecord(value)) || ancestors.has(value)) return false
  ancestors.add(value)
  const valid = Object.entries(value).every(([key, child]) => !isProtoPollutingKey(key) && isPayloadValue(child, ancestors))
  ancestors.delete(value)
  return valid
}

function readPayloadLeaves(value: unknown): Map<string, unknown> | null {
  if (!isPlainRecord(value)) return null
  const leaves = new Map<string, unknown>()
  const ancestors = new Set<object>()
  function visit(record: FormRecord, prefix: string): boolean {
    if (ancestors.has(record)) return false
    ancestors.add(record)
    for (const [key, child] of Object.entries(record)) {
      if (!key || key.includes('.') || isProtoPollutingKey(key)) return false
      if (child === undefined) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (prefix !== 'customFields' && isPlainRecord(child) && Object.keys(child).length) {
        if (!visit(child, path)) return false
      } else if (isPayloadValue(child, ancestors)) {
        leaves.set(path, child)
      } else return false
    }
    ancestors.delete(record)
    return true
  }
  return visit(value, '') ? leaves : null
}

function appendLeaves(
  payload: FormRecord, fragment: ReadonlyMap<string, unknown>, claimed: Set<string>, branches: Set<string>,
): boolean {
  for (const [path, value] of fragment) {
    if (claimed.has(path) || branches.has(path)) return false
    let boundary = path.indexOf('.')
    while (boundary !== -1) {
      const prefix = path.slice(0, boundary)
      if (claimed.has(prefix)) return false
      branches.add(prefix)
      boundary = path.indexOf('.', boundary + 1)
    }
    claimed.add(path)
    writeByDotPath(payload, path, value)
  }
  return true
}

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
