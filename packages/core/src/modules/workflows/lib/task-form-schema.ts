/**
 * Workflows Module - Task form schema normalization (pure)
 *
 * `userTaskConfigSchema.formSchema` has always accepted TWO shapes:
 *
 *   - `{ properties, required }` — JSON Schema;
 *   - `{ fields: [{ name, type, label, required, options }] }` — the authoring
 *     shape the Studio's form-field editor writes (`lib/nodeFormTransforms.ts`).
 *
 * Only the first was ever read. The task page renders `formSchema.properties`,
 * and `validateFormData` checked `formSchema.required` — so a task authored in
 * the visual editor rendered NO fields and validated NOTHING, however many its
 * author marked mandatory.
 *
 * This module is the one place the two shapes are reconciled: every reader goes
 * through `normalizeTaskFormSchema` and every required-field check through
 * `readRequiredFormFields`, so they cannot drift apart again. The mapping is the
 * exact inverse of `mapJsonSchemaTypeToFieldType`, which is what makes the
 * editor round trip.
 *
 * PURE: no ORM, DI, React or registry imports — the browser renderer and the
 * server-side completion path both load it.
 */

import type { JsonSchema, JsonSchemaField } from '../data/types'

interface AuthoredFormField {
  name: string
  type?: string
  label?: string
  required?: boolean
  options?: unknown[]
  placeholder?: string
  defaultValue?: unknown
}

function readAuthoredFields(formSchema: unknown): AuthoredFormField[] | null {
  if (!formSchema || typeof formSchema !== 'object') return null
  const fields = (formSchema as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return null
  return fields.filter(
    (field): field is AuthoredFormField =>
      !!field && typeof field === 'object' && typeof (field as { name?: unknown }).name === 'string'
  )
}

function readJsonSchema(formSchema: unknown): JsonSchema | null {
  if (!formSchema || typeof formSchema !== 'object') return null
  const schema = formSchema as { properties?: unknown; required?: unknown }
  if (!schema.properties || typeof schema.properties !== 'object') return null
  return formSchema as JsonSchema
}

/** Inverse of the editor's `mapJsonSchemaTypeToFieldType`. */
function authoredTypeToJsonSchemaField(field: AuthoredFormField): JsonSchemaField {
  const options = Array.isArray(field.options)
    ? field.options.filter((option): option is string => typeof option === 'string')
    : null

  const base: JsonSchemaField = {
    title: field.label ?? field.name,
    ...(field.placeholder ? { description: field.placeholder } : {}),
  }

  if (options?.length) return { ...base, type: 'string', enum: options }

  switch (field.type) {
    case 'number':
      return { ...base, type: 'number' }
    case 'integer':
      return { ...base, type: 'integer' }
    case 'checkbox':
    case 'boolean':
      return { ...base, type: 'boolean' }
    case 'email':
      return { ...base, type: 'string', format: 'email' }
    case 'url':
      return { ...base, type: 'string', format: 'uri' }
    case 'date':
      return { ...base, type: 'string', format: 'date' }
    case 'time':
      return { ...base, type: 'string', format: 'time' }
    case 'datetime-local':
      return { ...base, type: 'string', format: 'date-time' }
    case 'textarea':
      return { ...base, type: 'string', maxLength: 2000 }
    default:
      return { ...base, type: 'string' }
  }
}

/**
 * Present either authored shape as the JSON-Schema shape the renderer walks.
 * Returns `null` when the schema declares no fields at all, which is what the
 * "this task has no form" branch keys off.
 */
export function normalizeTaskFormSchema(formSchema: unknown): JsonSchema | null {
  const authored = readAuthoredFields(formSchema)
  if (authored) {
    if (!authored.length) return null
    const properties: Record<string, JsonSchemaField> = {}
    const required: string[] = []
    for (const field of authored) {
      properties[field.name] = authoredTypeToJsonSchemaField(field)
      if (field.required === true) required.push(field.name)
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) }
  }

  const jsonSchema = readJsonSchema(formSchema)
  if (!jsonSchema) return null
  return Object.keys(jsonSchema.properties ?? {}).length ? jsonSchema : null
}

/**
 * Names of the fields a form schema declares as required, in EITHER shape.
 * The authoring shape carries a per-field `required: true`; JSON Schema carries
 * a `required` array.
 */
export function readRequiredFormFields(formSchema: unknown): string[] {
  const normalized = normalizeTaskFormSchema(formSchema)
  return normalized?.required ?? []
}

/** How many fields the schema declares, in either shape. */
export function countTaskFormFields(formSchema: unknown): number {
  const normalized = normalizeTaskFormSchema(formSchema)
  return normalized ? Object.keys(normalized.properties ?? {}).length : 0
}
