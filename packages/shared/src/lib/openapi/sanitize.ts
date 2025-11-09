type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

function toComponentName(hint: string, fallbackIndex: number): string {
  const cleaned = hint
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('')
  return cleaned.length ? cleaned : `Schema${fallbackIndex}`
}

const SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'items',
  'anyOf',
  'oneOf',
  'allOf',
  '$ref',
  'enum',
  'format',
  'not',
  'additionalProperties',
  'required',
  'pattern',
  'minimum',
  'maximum',
])

function looksLikeSchema(value: Record<string, unknown>): boolean {
  if (typeof value.$ref === 'string') return true
  for (const key of Object.keys(value)) {
    if (SCHEMA_KEYS.has(key)) return true
  }
  return false
}

export function sanitizeOpenApiDocument<T extends Record<string, any>>(doc: T): T {
  const schemaNameMap = new Map<object, string>()
  const schemas: Record<string, JsonValue> = doc.components?.schemas ?? {}
  if (!doc.components) doc.components = {} as T['components']
  doc.components.schemas = schemas as any
  let counter = Object.keys(schemas).length

  const cloneContainer = (
    source: Record<string, any>,
    hint: string,
    mode?: 'properties' | 'patternProperties'
  ): JsonValue => {
    const clone: Record<string, JsonValue> = {}
    for (const [key, value] of Object.entries(source)) {
      const forceSchema = mode === 'properties' || mode === 'patternProperties'
      clone[key] = cloneSchemaValue(value, `${hint}_${key}`, key, forceSchema)
    }
    return clone
  }

  const serializeSchema = (schema: Record<string, any>, hint: string): JsonValue => {
    if (schemaNameMap.has(schema)) {
      const name = schemaNameMap.get(schema)!
      return { $ref: `#/components/schemas/${name}` }
    }
    counter += 1
    const tentativeName = toComponentName(hint, counter)
    let name = tentativeName
    let suffix = 1
    while (schemas[name]) {
      name = `${tentativeName}${suffix++}`
    }
    schemaNameMap.set(schema, name)
    schemas[name] = cloneContainer(schema, hint)
    return { $ref: `#/components/schemas/${name}` }
  }

  const cloneSchemaValue = (
    value: any,
    hint: string,
    parentKey?: string,
    forceSchema = false
  ): JsonValue => {
    if (Array.isArray(value)) {
      return value.map((entry, idx) => cloneSchemaValue(entry, `${hint}_${idx}`, parentKey, forceSchema)) as JsonValue
    }
    if (isPlainObject(value)) {
      if (typeof value.$ref === 'string') return value
      if (parentKey === 'properties' || parentKey === 'patternProperties') {
        return cloneContainer(value, hint, parentKey)
      }
      if (parentKey === 'additionalProperties' && Object.keys(value).length) {
        return serializeSchema(value, hint)
      }
      if (forceSchema || looksLikeSchema(value)) {
        return serializeSchema(value, hint)
      }
      return cloneContainer(value, hint)
    }
    return value as JsonValue
  }

  const traverse = (value: any, hint: string): any => {
    if (Array.isArray(value)) {
      return value.map((entry, idx) => traverse(entry, `${hint}_${idx}`))
    }
    if (!isPlainObject(value)) return value
    const result: Record<string, unknown> = { ...value }
    for (const [key, child] of Object.entries(result)) {
      if (key === 'schema' && child && typeof child === 'object') {
        result[key] = cloneSchemaValue(child, `${hint}_${key}`, key)
      } else {
        result[key] = traverse(child, `${hint}_${key}`)
      }
    }
    return result
  }

  return traverse(doc, 'doc')
}
