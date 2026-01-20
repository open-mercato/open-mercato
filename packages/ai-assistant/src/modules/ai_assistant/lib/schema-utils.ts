import { z, type ZodType } from 'zod'

/**
 * Cache for converted safe schemas to avoid repeated conversions per request.
 */
const safeSchemaCache = new WeakMap<ZodType, ZodType>()

/**
 * Convert a JSON Schema to a simple Zod schema.
 * This creates a schema that can be converted back to JSON Schema without errors.
 *
 * Supports:
 * - Basic types: string, number, integer, boolean, null
 * - Arrays with item types
 * - Objects with properties and required fields
 * - Records/dictionaries via additionalProperties
 * - Union types via anyOf/oneOf
 * - Enum values
 */
export function jsonSchemaToZod(jsonSchema: Record<string, unknown>): ZodType {
  const type = jsonSchema.type as string | undefined

  if (type === 'string') {
    return z.string()
  }
  if (type === 'number' || type === 'integer') {
    return z.number()
  }
  if (type === 'boolean') {
    return z.boolean()
  }
  if (type === 'null') {
    return z.null()
  }
  if (type === 'array') {
    const items = jsonSchema.items as Record<string, unknown> | undefined
    if (items) {
      return z.array(jsonSchemaToZod(items))
    }
    return z.array(z.unknown())
  }
  if (type === 'object') {
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>> | undefined
    const required = (jsonSchema.required as string[]) || []
    const additionalProperties = jsonSchema.additionalProperties

    // Handle z.record() - objects with additionalProperties but no fixed properties
    if (additionalProperties && (!properties || Object.keys(properties).length === 0)) {
      // This is a record/dictionary type - allow any properties
      if (typeof additionalProperties === 'object') {
        return z.record(z.string(), jsonSchemaToZod(additionalProperties as Record<string, unknown>))
      }
      // additionalProperties: true means any value
      return z.record(z.string(), z.unknown())
    }

    if (properties) {
      const shape: Record<string, ZodType> = {}
      for (const [key, propSchema] of Object.entries(properties)) {
        let fieldSchema = jsonSchemaToZod(propSchema)
        // Make field optional if not in required array
        if (!required.includes(key)) {
          fieldSchema = fieldSchema.optional()
        }
        shape[key] = fieldSchema
      }
      // If additionalProperties is allowed, use passthrough
      if (additionalProperties) {
        return z.object(shape).passthrough()
      }
      return z.object(shape)
    }

    // Empty object with additionalProperties - treat as record
    if (additionalProperties) {
      return z.record(z.string(), z.unknown())
    }
    return z.object({})
  }

  // Handle union types (anyOf, oneOf)
  const anyOf = jsonSchema.anyOf as Record<string, unknown>[] | undefined
  const oneOf = jsonSchema.oneOf as Record<string, unknown>[] | undefined
  const unionTypes = anyOf || oneOf
  if (unionTypes && unionTypes.length >= 2) {
    const schemas = unionTypes.map(s => jsonSchemaToZod(s))
    return z.union(schemas as [ZodType, ZodType, ...ZodType[]])
  }

  // Handle nullable via anyOf with null
  if (anyOf && anyOf.length === 2) {
    const types = anyOf.map((s) => s.type)
    if (types.includes('null')) {
      const nonNullSchema = anyOf.find((s) => s.type !== 'null')
      if (nonNullSchema) {
        return jsonSchemaToZod(nonNullSchema).nullable()
      }
    }
  }

  // Handle enum
  const enumValues = jsonSchema.enum as string[] | undefined
  if (enumValues && enumValues.length > 0) {
    return z.enum(enumValues as [string, ...string[]])
  }

  // Fallback for empty schemas (like Date converted with unrepresentable: 'any')
  return z.unknown()
}

/**
 * Convert a Zod schema to a safe Zod schema that has no Date types.
 * Uses JSON Schema as an intermediate format to handle all Zod v4 internal complexities.
 * Results are cached to avoid repeated conversions.
 *
 * @param schema - The original Zod schema
 * @returns A safe Zod schema without Date types
 */
export function toSafeZodSchema(schema: ZodType): ZodType {
  // Check cache first
  const cached = safeSchemaCache.get(schema)
  if (cached) {
    return cached
  }

  try {
    // Use Zod 4's toJSONSchema with unrepresentable: 'any' to handle Date types
    const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>

    // Convert back to a simple Zod schema without Date types
    const safeSchema = jsonSchemaToZod(jsonSchema)

    // Cache the result
    safeSchemaCache.set(schema, safeSchema)

    return safeSchema
  } catch (error) {
    console.error('[Schema Utils] Error converting schema:', error)
    // Fallback to the original schema if conversion fails
    return schema
  }
}
