/**
 * `group` field type — W6 (FA-8 repeatable groups).
 *
 * Lets a participant add N repeated entries — e.g. "add a medication" with
 * sub-fields (name, dose) repeated as many times as needed. This is the
 * defining capability for medical-history / line-item style questionnaires.
 *
 * Schema representation (additive, one level of nesting):
 *   {
 *     type: 'array',
 *     'x-om-type': 'group',
 *     'x-om-label': { en: 'Medications' },
 *     'x-om-min-items'?: number,         // lower bound on entry count
 *     'x-om-max-items'?: number,         // upper bound on entry count
 *     items: {
 *       type: 'object',
 *       additionalProperties: false,
 *       required: [<subFieldKey>...],
 *       properties: {
 *         <subFieldKey>: {                // a normal field node, SAME x-om-*
 *           type: 'string',               // keywords as a top-level field
 *           'x-om-type': 'text',
 *           'x-om-label': { en: 'Name' },
 *         },
 *         ...
 *       },
 *     },
 *   }
 *
 * Value shape: an array of objects, each object keyed by sub-field key:
 *   [{ name: 'Aspirin', dose: '100mg' }, { name: 'Ibuprofen', dose: '200mg' }]
 *
 * Role policy: the group is treated ATOMICALLY. Sub-fields inherit the group's
 * `x-om-editable-by` / `x-om-visible-to` — they are NOT independent
 * fieldIndex entries, so the RolePolicyService slices the whole array in/out
 * as a unit (W6 decision — keep it simple).
 *
 * The `group` type is ADDITIVE — registered through the standard
 * `FieldTypeRegistry.register(...)` API; it does NOT appear in the FROZEN v1
 * core list (`packages/forms/AGENTS.md § v1 Field Types`).
 *
 * New `x-om-*` keywords (all additive, registered in `jsonschema-extensions.ts`):
 *   - `x-om-min-items` — minimum number of entries (default 0)
 *   - `x-om-max-items` — maximum number of entries (absent ⇒ unbounded)
 *
 * Out of scope (explicitly): nested groups within a group. A sub-field whose
 * `x-om-type` is itself `group` is rejected by `validateOmCrossKeyword`. One
 * level of nesting is sufficient for the FA-8 requirement.
 */

import type { FieldNode, FieldTypeSpec } from './field-type-registry'
import { defaultFieldTypeRegistry, type FieldTypeRegistry } from './field-type-registry'

export const GROUP_TYPE_KEY = 'group' as const

export { GROUP_MAX_ITEMS_SOFT_CAP } from './jsonschema-extensions'

/** Descriptor for a single sub-field declared under the group's `items.properties`. */
export type GroupSubFieldDescriptor = {
  key: string
  type: string
  required: boolean
  /** The raw sub-field node (carries `x-om-label`, validation keywords, etc.). */
  node: FieldNode
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Reads the group's sub-field descriptors from `items.properties`, in the
 * persisted `Object.entries` order. Returns an empty list when the group is
 * malformed (defensive — the compiler validates the shape up front).
 */
export function readGroupSubFields(fieldNode: FieldNode): GroupSubFieldDescriptor[] {
  const items = (fieldNode as Record<string, unknown>).items
  if (!isPlainObject(items)) return []
  const properties = items.properties
  if (!isPlainObject(properties)) return []
  const requiredRaw = items.required
  const requiredSet = new Set(
    Array.isArray(requiredRaw)
      ? requiredRaw.filter((entry): entry is string => typeof entry === 'string')
      : [],
  )
  const result: GroupSubFieldDescriptor[] = []
  for (const [subKey, rawNode] of Object.entries(properties)) {
    if (!isPlainObject(rawNode)) continue
    const subType = rawNode['x-om-type']
    if (typeof subType !== 'string' || subType.length === 0) continue
    result.push({
      key: subKey,
      type: subType,
      required: requiredSet.has(subKey),
      node: rawNode as FieldNode,
    })
  }
  return result
}

function readItemBound(fieldNode: FieldNode, keyword: 'x-om-min-items' | 'x-om-max-items'): number | null {
  const raw = (fieldNode as Record<string, unknown>)[keyword]
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null
}

export function readGroupMinItems(fieldNode: FieldNode): number {
  return readItemBound(fieldNode, 'x-om-min-items') ?? 0
}

export function readGroupMaxItems(fieldNode: FieldNode): number | null {
  return readItemBound(fieldNode, 'x-om-max-items')
}

/**
 * Validates a single repeated entry against the sub-field descriptors using
 * the per-type validators from the registry. Returns `true` or an error string.
 */
function validateGroupEntry(
  entry: unknown,
  subFields: GroupSubFieldDescriptor[],
  registry: FieldTypeRegistry,
): true | string {
  if (!isPlainObject(entry)) return 'Each group entry must be an object.'
  const knownKeys = new Set(subFields.map((subField) => subField.key))
  for (const presentKey of Object.keys(entry)) {
    if (!knownKeys.has(presentKey)) {
      return `Group entry references unknown sub-field "${presentKey}".`
    }
  }
  for (const subField of subFields) {
    const value = entry[subField.key]
    const isMissing =
      value === undefined
      || value === null
      || (typeof value === 'string' && value.length === 0)
      || (Array.isArray(value) && value.length === 0)
    if (subField.required && isMissing) {
      return `Sub-field "${subField.key}" is required in every group entry.`
    }
    if (isMissing) continue
    const spec = registry.get(subField.type)
    if (!spec) {
      return `Sub-field "${subField.key}" declares unregistered type "${subField.type}".`
    }
    const result = spec.validator(value, subField.node)
    if (result !== true) {
      return `Sub-field "${subField.key}": ${result}`
    }
  }
  return true
}

/**
 * Builds the `group` field-type spec. The validator and exportAdapter consult
 * the registry to resolve each sub-field's per-type behaviour, so the spec is
 * a factory bound to a registry (defaults to the singleton).
 *
 * The registry is resolved lazily at call time (not at construction): the
 * default-singleton `GROUP_TYPE` is built from this module, which is imported
 * by `field-type-registry.ts` BEFORE the singleton is constructed — binding
 * eagerly would capture `undefined` (circular-import init order).
 */
export function createGroupTypeSpec(registry?: FieldTypeRegistry): FieldTypeSpec {
  const resolveRegistry = (): FieldTypeRegistry => registry ?? defaultFieldTypeRegistry
  return {
    validator: (value, fieldNode) => {
      if (value === null || value === undefined) return true
      if (!Array.isArray(value)) return 'Expected an array of group entries.'
      const min = readGroupMinItems(fieldNode)
      const max = readGroupMaxItems(fieldNode)
      if (value.length < min) {
        return `Please add at least ${min} ${min === 1 ? 'entry' : 'entries'}.`
      }
      if (max !== null && value.length > max) {
        return `Please add no more than ${max} ${max === 1 ? 'entry' : 'entries'}.`
      }
      const subFields = readGroupSubFields(fieldNode)
      const registryInstance = resolveRegistry()
      for (const entry of value) {
        const result = validateGroupEntry(entry, subFields, registryInstance)
        if (result !== true) return result
      }
      return true
    },
    renderer: null,
    defaultUiSchema: { widget: 'group' },
    exportAdapter: (value, fieldNode) => {
      if (!Array.isArray(value) || value.length === 0) return ''
      const subFields = fieldNode ? readGroupSubFields(fieldNode) : []
      const registryInstance = resolveRegistry()
      const lines = value.map((entry, index) => {
        if (!isPlainObject(entry)) return `#${index + 1}`
        if (subFields.length === 0) {
          const parts = Object.entries(entry).map(([key, raw]) => `${key}: ${stringifyScalar(raw)}`)
          return `#${index + 1} ${parts.join(', ')}`
        }
        const parts = subFields.map((subField) => {
          const spec = registryInstance.get(subField.type)
          const raw = entry[subField.key]
          const rendered = spec ? spec.exportAdapter(raw, subField.node) : stringifyScalar(raw)
          const label = readEnLabel(subField.node) ?? subField.key
          return `${label}: ${rendered.length > 0 ? rendered : '—'}`
        })
        return `#${index + 1} ${parts.join(', ')}`
      })
      return lines.join(' | ')
    },
    category: 'input',
    icon: 'rows',
    displayNameKey: 'forms.studio.palette.input.group',
  }
}

function stringifyScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((entry) => stringifyScalar(entry)).join(', ')
  return JSON.stringify(value)
}

function readEnLabel(node: FieldNode): string | null {
  const label = (node as Record<string, unknown>)['x-om-label']
  if (!isPlainObject(label)) return null
  const en = label.en
  if (typeof en === 'string' && en.length > 0) return en
  for (const value of Object.values(label)) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/** The `group` spec bound to the default singleton registry. */
export const GROUP_TYPE: FieldTypeSpec = createGroupTypeSpec()
