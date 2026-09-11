import { z, type ZodTypeAny } from 'zod'
import { agentArtifactResultSchema } from '../../data/validators'

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

export type OutcomeKind = 'researcher' | 'proposal' | 'artifact'

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
 *   researcher ⇒ z.object({ kind: z.literal('researcher'), data: <schema> })
 *   proposal  ⇒ z.object({ kind: z.literal('proposal'),  proposal: <schema> })
 *   artifact  ⇒ the FIXED artifact envelope; the declared schema is ignored
 *
 * An artifact result has nothing per-agent to type: what came back is a list of
 * files the run's own file plane captured, and the same shape describes a drafted
 * email and a risk report. Accepting a schema and then ignoring it would be worse
 * than either taking one or refusing one, so an artifact OUTCOME.md declares no
 * JSON block at all (`parseOutcomeMarkdown` makes it optional for this kind).
 */
export function compileOutcome(input: { kind: OutcomeKind; schema?: JsonSchemaNode }): {
  kind: OutcomeKind
  resultSchema: ZodTypeAny
} {
  if (input.kind === 'artifact') {
    return {
      kind: input.kind,
      resultSchema: z.object({ kind: z.literal('artifact'), ...agentArtifactResultSchema.shape }),
    }
  }
  if (!input.schema) {
    throw new UnsupportedOutcomeSchemaError(`the "${input.kind}" outcome kind requires a JSON schema`)
  }
  const inner = jsonSchemaToZod(input.schema)
  const resultSchema =
    input.kind === 'researcher'
      ? z.object({ kind: z.literal('researcher'), data: inner })
      : z.object({ kind: z.literal('proposal'), proposal: inner })
  return { kind: input.kind, resultSchema }
}
