type UserTaskFormField = {
  name?: unknown
  type?: unknown
  label?: unknown
  required?: unknown
  placeholder?: unknown
  options?: unknown
  defaultValue?: unknown
}

type JsonSchemaField = {
  type?: string
  title?: string
  enum?: string[]
  format?: string
  description?: string
  placeholder?: string
  default?: unknown
  maxLength?: number
}

export type NormalizedUserTaskFormSchema = {
  type?: string
  title?: string
  properties: Record<string, JsonSchemaField>
  required?: string[]
  fields?: UserTaskFormField[]
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fieldTypeToJsonSchema(fieldType: string): Pick<JsonSchemaField, 'type' | 'format' | 'maxLength'> {
  switch (fieldType) {
    case 'number':
      return { type: 'number' }
    case 'integer':
      return { type: 'integer' }
    case 'checkbox':
    case 'boolean':
      return { type: 'boolean' }
    case 'email':
      return { type: 'string', format: 'email' }
    case 'url':
      return { type: 'string', format: 'uri' }
    case 'tel':
      return { type: 'string', format: 'tel' }
    case 'date':
      return { type: 'string', format: 'date' }
    case 'time':
      return { type: 'string', format: 'time' }
    case 'datetime-local':
      return { type: 'string', format: 'date-time' }
    case 'textarea':
      return { type: 'string', maxLength: 2000 }
    case 'select':
    case 'radio':
    case 'text':
    default:
      return { type: 'string' }
  }
}

function normalizeFormField(field: UserTaskFormField): { name: string; schema: JsonSchemaField; required: boolean } | null {
  if (typeof field.name !== 'string' || field.name.trim().length === 0) {
    return null
  }

  const name = field.name.trim()
  const fieldType = typeof field.type === 'string' ? field.type : 'text'
  const schema: JsonSchemaField = {
    ...fieldTypeToJsonSchema(fieldType),
    title: typeof field.label === 'string' && field.label.trim().length > 0 ? field.label : name,
  }

  if (typeof field.placeholder === 'string' && field.placeholder.length > 0) {
    schema.description = field.placeholder
    schema.placeholder = field.placeholder
  }

  if (Array.isArray(field.options) && field.options.length > 0) {
    schema.enum = field.options.map(String)
  }

  if (field.defaultValue !== undefined && field.defaultValue !== '') {
    schema.default = field.defaultValue
  }

  return {
    name,
    schema,
    required: field.required === true,
  }
}

export function normalizeUserTaskFormSchema(schema: unknown): NormalizedUserTaskFormSchema | null {
  if (!isRecord(schema)) {
    return null
  }

  if (isRecord(schema.properties)) {
    return schema as NormalizedUserTaskFormSchema
  }

  if (!Array.isArray(schema.fields)) {
    return null
  }

  const properties: Record<string, JsonSchemaField> = {}
  const required: string[] = []

  for (const field of schema.fields) {
    if (!isRecord(field)) {
      continue
    }

    const normalized = normalizeFormField(field)
    if (!normalized) {
      continue
    }

    properties[normalized.name] = normalized.schema
    if (normalized.required) {
      required.push(normalized.name)
    }
  }

  if (Object.keys(properties).length === 0) {
    return null
  }

  return {
    ...schema,
    type: typeof schema.type === 'string' ? schema.type : 'object',
    properties,
    required,
  } as NormalizedUserTaskFormSchema
}
