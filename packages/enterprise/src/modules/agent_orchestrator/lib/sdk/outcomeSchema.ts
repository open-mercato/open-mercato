import { z, type ZodTypeAny } from 'zod'

/**
 * Narrow runtime type for the JSON-Schema subset OUTCOME.md may declare. This is
 * intentionally permissive at the type level (every field optional) so a parsed
 * JSON value can be assigned to it without `any`; `jsonSchemaToZod` narrows each
 * node at runtime and throws on anything outside the supported subset.
 */
export type JsonSchemaNode = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean'
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaNode
  minItems?: number
  minLength?: number
  enum?: Array<string>
  minimum?: number
  maximum?: number
  nullable?: boolean
  const?: string | number | boolean
}

export type OutcomeKind = 'informative' | 'actionable'

/**
 * Thrown when OUTCOME.md declares a JSON-Schema keyword outside the supported
 * subset (see `jsonSchemaToZod`). Internal-only: prefixed so the i18n
 * hardcoded-string checker treats it as opted out — generation surfaces it, the
 * end user never sees it raw.
 */
export class UnsupportedOutcomeSchemaError extends Error {
  constructor(message: string) {
    super(`[internal] unsupported OUTCOME schema: ${message}`)
    this.name = 'UnsupportedOutcomeSchemaError'
  }
}

const UNSUPPORTED_KEYWORDS = [
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  '$ref',
  'format',
  'patternProperties',
  'pattern',
  'additionalItems',
  'propertyNames',
  'if',
  'then',
  'else',
] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNoUnsupportedKeywords(node: Record<string, unknown>): void {
  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (keyword in node) {
      throw new UnsupportedOutcomeSchemaError(`keyword "${keyword}" is not supported`)
    }
  }
}

function applyNullable(schema: ZodTypeAny, node: JsonSchemaNode): ZodTypeAny {
  return node.nullable === true ? schema.nullable() : schema
}

/**
 * Convert a supported JSON-Schema subset to a Zod schema. Throws
 * `UnsupportedOutcomeSchemaError` on any unsupported node so generation fails
 * loudly rather than silently producing a permissive validator.
 *
 * Supported: object (properties/required/additionalProperties), array
 * (items/minItems), string (minLength/enum), number/integer (minimum/maximum),
 * boolean, nullable, const, and arbitrary nesting of the above.
 */
export function jsonSchemaToZod(schema: JsonSchemaNode): ZodTypeAny {
  if (!isPlainObject(schema)) {
    throw new UnsupportedOutcomeSchemaError('schema node must be an object')
  }
  assertNoUnsupportedKeywords(schema)

  if (schema.const !== undefined) {
    return applyNullable(z.literal(schema.const), schema)
  }

  const { type } = schema
  if (type === undefined) {
    throw new UnsupportedOutcomeSchemaError('schema node is missing a "type"')
  }

  switch (type) {
    case 'object': {
      const properties = schema.properties ?? {}
      if (!isPlainObject(properties)) {
        throw new UnsupportedOutcomeSchemaError('object "properties" must be an object')
      }
      const required = new Set(Array.isArray(schema.required) ? schema.required : [])
      const shape: Record<string, ZodTypeAny> = {}
      for (const [key, child] of Object.entries(properties)) {
        const childSchema = jsonSchemaToZod(child)
        shape[key] = required.has(key) ? childSchema : childSchema.optional()
      }
      const base = z.object(shape)
      const objectSchema = schema.additionalProperties === false ? base.strict() : base
      return applyNullable(objectSchema, schema)
    }
    case 'array': {
      if (!schema.items) {
        throw new UnsupportedOutcomeSchemaError('array "items" is required')
      }
      let arraySchema = z.array(jsonSchemaToZod(schema.items))
      if (typeof schema.minItems === 'number') {
        arraySchema = arraySchema.min(schema.minItems)
      }
      return applyNullable(arraySchema, schema)
    }
    case 'string': {
      if (Array.isArray(schema.enum)) {
        if (schema.enum.length === 0) {
          throw new UnsupportedOutcomeSchemaError('string "enum" must not be empty')
        }
        if (!schema.enum.every((value): value is string => typeof value === 'string')) {
          throw new UnsupportedOutcomeSchemaError('string "enum" must contain only strings')
        }
        return applyNullable(z.enum(schema.enum as [string, ...string[]]), schema)
      }
      let stringSchema = z.string()
      if (typeof schema.minLength === 'number') {
        stringSchema = stringSchema.min(schema.minLength)
      }
      return applyNullable(stringSchema, schema)
    }
    case 'number':
    case 'integer': {
      let numberSchema = type === 'integer' ? z.number().int() : z.number()
      if (typeof schema.minimum === 'number') {
        numberSchema = numberSchema.min(schema.minimum)
      }
      if (typeof schema.maximum === 'number') {
        numberSchema = numberSchema.max(schema.maximum)
      }
      return applyNullable(numberSchema, schema)
    }
    case 'boolean': {
      return applyNullable(z.boolean(), schema)
    }
    default: {
      throw new UnsupportedOutcomeSchemaError(`type "${String(type)}" is not supported`)
    }
  }
}

/**
 * Compile an OUTCOME.md descriptor into the SAME AgentResult shape `defineAgent`
 * feeds the runtime, so all downstream validation/persistence works unchanged:
 *   informative ⇒ z.object({ kind: z.literal('informative'), data: <schema> })
 *   actionable  ⇒ z.object({ kind: z.literal('actionable'),  proposal: <schema> })
 */
export function compileOutcome(input: { kind: OutcomeKind; schema: JsonSchemaNode }): {
  kind: OutcomeKind
  resultSchema: ZodTypeAny
} {
  const inner = jsonSchemaToZod(input.schema)
  const resultSchema =
    input.kind === 'informative'
      ? z.object({ kind: z.literal('informative'), data: inner })
      : z.object({ kind: z.literal('actionable'), proposal: inner })
  return { kind: input.kind, resultSchema }
}
