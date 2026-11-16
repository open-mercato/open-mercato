import type { JsonSchemaNode } from './outcomeSchema'

/**
 * Provider-native structured output for file-defined agents (A-2).
 *
 * Strict structured-output modes (OpenAI / Azure OpenAI, and the AI SDK default
 * for them) only accept object schemas that list EVERY property in `required` and
 * set `additionalProperties: false`. An OUTCOME.md schema routinely has optional
 * properties, which those providers reject before the model runs. The model is
 * therefore given a strict variant — every property required, previously optional
 * ones made `nullable` — and its answer is mapped back with `stripOptionalNulls`
 * before it is validated against the AUTHORED schema, which stays the contract.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The strict variant of an OUTCOME schema, or null when the schema contains an
 * open object (no declared properties) that a strict mode cannot describe — the
 * caller then keeps the authored schema.
 */
export function toStrictOutcomeSchema(node: JsonSchemaNode): JsonSchemaNode | null {
  if (node.type === 'object') {
    const properties = node.properties ?? {}
    const keys = Object.keys(properties)
    if (keys.length === 0 && node.additionalProperties !== false) return null
    const required = new Set(node.required ?? [])
    const strictProperties: Record<string, JsonSchemaNode> = {}
    for (const key of keys) {
      const child = toStrictOutcomeSchema(properties[key])
      if (!child) return null
      strictProperties[key] = required.has(key) ? child : { ...child, nullable: true }
    }
    return { ...node, properties: strictProperties, required: keys, additionalProperties: false }
  }
  if (node.type === 'array' && node.items) {
    const items = toStrictOutcomeSchema(node.items)
    if (!items) return null
    return { ...node, items }
  }
  return { ...node }
}

/**
 * Undo the strict variant on a model answer: drop a `null` the model returned for
 * a property the authored schema declared optional and not nullable, recursively.
 * Anything else passes through untouched, so the authored schema still judges it.
 */
export function stripOptionalNulls(value: unknown, schema: JsonSchemaNode | undefined): unknown {
  if (!schema) return value
  if (schema.type === 'array' && Array.isArray(value)) {
    return value.map((item) => stripOptionalNulls(item, schema.items))
  }
  if (schema.type !== 'object' || !isPlainObject(value)) return value
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key]
    if (child === null && childSchema && !required.has(key) && childSchema.nullable !== true) continue
    result[key] = stripOptionalNulls(child, childSchema)
  }
  return result
}
