import { z, ZodFirstPartyTypeKind, type ZodTypeAny } from 'zod'
import type { Module, ModuleApi, ModuleApiLegacy, ModuleApiRouteFile, HttpMethod } from '@/modules/registry'
import type {
  OpenApiDocument,
  OpenApiDocumentOptions,
  OpenApiMethodDoc,
  OpenApiRequestBodyDoc,
  OpenApiResponseDoc,
  OpenApiRouteDoc,
} from './types'

type PathParamInfo = {
  name: string
  catchAll?: boolean
  optional?: boolean
}

type ParameterLocation = 'query' | 'path' | 'header'

type JsonSchema = Record<string, unknown>

type SchemaConversionContext = {
  memo: WeakMap<ZodTypeAny, JsonSchema>
}

type ExampleGenerationContext = {
  stack: WeakSet<ZodTypeAny>
}

type ExampleMap = {
  query?: unknown
  body?: unknown
  path?: Record<string, unknown>
  headers?: Record<string, unknown>
}

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function resolveType(def: any): string | undefined {
  if (!def) return undefined
  if (typeof def.typeName === 'string' && def.typeName.length) return def.typeName
  if (typeof def.type === 'string' && def.type.length) return def.type
  return undefined
}

function getShape(def: any): Record<string, ZodTypeAny> {
  if (!def) return {}
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape
  if (shape && typeof shape === 'object') return shape as Record<string, ZodTypeAny>
  return {}
}

function normalizeChecks(checks: any[] | undefined): Array<{ kind?: string; value?: unknown; extra?: Record<string, unknown> }> {
  if (!Array.isArray(checks)) return []
  return checks.map((check) => {
    if (!check) return {}
    const base = (check as any)?._zod?.def ?? (check as any)?.def ?? check
    const kind = typeof (check as any)?.kind === 'string'
      ? (check as any).kind
      : typeof base?.check === 'string'
        ? base.check
        : undefined
    const value =
      base?.value ??
      base?.minimum ??
      base?.maximum ??
      base?.exact ??
      base?.length ??
      base?.limit ??
      base?.includes ??
      base?.min ??
      base?.max
    return { kind, value, extra: base && typeof base === 'object' ? base : undefined }
  })
}

const DEFAULT_EXAMPLE_VALUES = {
  string: 'string',
  number: 1,
  integer: 1,
  boolean: true,
  uuid: '00000000-0000-4000-8000-000000000000',
  email: 'user@example.com',
  url: 'https://example.com/resource',
  datetime: new Date('2025-01-01T00:00:00.000Z').toISOString(),
}

function toTitle(str: string): string {
  if (!str) return ''
  return str
    .split(/[_\-\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizePath(path: string): { path: string; params: PathParamInfo[] } {
  const segments = path.split('/').filter((seg) => seg.length > 0)
  const params: PathParamInfo[] = []
  const normalized = segments
    .map((seg) => {
      const catchAll = seg.match(/^\[\.\.\.(.+)\]$/)
      if (catchAll) {
        params.push({ name: catchAll[1], catchAll: true })
        return `{${catchAll[1]}}`
      }
      const optCatchAll = seg.match(/^\[\[\.\.\.(.+)\]\]$/)
      if (optCatchAll) {
        params.push({ name: optCatchAll[1], catchAll: true, optional: true })
        return `{${optCatchAll[1]}}`
      }
      const dyn = seg.match(/^\[(.+)\]$/)
      if (dyn) {
        params.push({ name: dyn[1] })
        return `{${dyn[1]}}`
      }
      return seg
    })
    .join('/')
  return { path: '/' + normalized, params }
}

function unwrap(schema?: ZodTypeAny): {
  schema: ZodTypeAny | undefined
  optional: boolean
  nullable: boolean
  defaultValue?: unknown
} {
  if (!schema) {
    return { schema: undefined, optional: true, nullable: false }
  }

  let current: ZodTypeAny = schema
  let optional = false
  let nullable = false
  let defaultValue: unknown
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const def = (current as any)?._def
    if (!def) {
      return { schema: current, optional, nullable, defaultValue }
    }
    const typeName = resolveType(def)
    if (typeName === ZodFirstPartyTypeKind.ZodOptional || typeName === 'optional') {
      optional = true
      current = (current as any)._def.innerType
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodNullable || typeName === 'nullable') {
      nullable = true
      current = (current as any)._def.innerType
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodDefault || typeName === 'default') {
      optional = true
      const rawDefault = (current as any)._def.defaultValue
      defaultValue = typeof rawDefault === 'function' ? rawDefault() : rawDefault
      current = (current as any)._def.innerType
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodPipeline || typeName === 'pipe') {
      current = (current as any)._def.out ?? (current as any)._def.innerType ?? (current as any)._def.schema
      continue
    }
    if (typeName === 'transformer') {
      current = (current as any)._def.output
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodLazy || typeName === 'lazy') {
      const getter = (current as any)._def.getter
      current = typeof getter === 'function' ? getter() : current
      if (current === schema) break
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodPromise || typeName === 'promise') {
      current = (current as any)._def.type
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodCatch || typeName === 'catch') {
      current = (current as any)._def.innerType
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodReadonly || typeName === 'readonly') {
      current = (current as any)._def.innerType
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodBranded || typeName === 'branded') {
      current = (current as any)._def.type
      continue
    }
    break
  }
  return { schema: current, optional, nullable, defaultValue }
}

function zodToJsonSchema(schema?: ZodTypeAny, ctx?: SchemaConversionContext): JsonSchema | undefined {
  if (!schema) return undefined
  const context: SchemaConversionContext = ctx ?? { memo: new WeakMap<ZodTypeAny, JsonSchema>() }

  const cached = context.memo.get(schema)
  if (cached) return cached

  const placeholder: JsonSchema = {}
  context.memo.set(schema, placeholder)

  const { schema: inner, nullable } = unwrap(schema)
  if (!inner) {
    if (nullable) placeholder.nullable = true
    return placeholder
  }

  if (inner !== schema && typeof inner === 'object') {
    if (!context.memo.has(inner as ZodTypeAny)) {
      context.memo.set(inner as ZodTypeAny, placeholder)
    }
  }

  const def = (inner as any)._def
  if (!def) return placeholder
  const typeName = resolveType(def) as ZodFirstPartyTypeKind | string | undefined

  const result = placeholder

  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString:
    case 'string': {
      result.type = 'string'
      const checks = normalizeChecks(def.checks)
      for (const check of checks) {
        if (!check.kind) continue
        if (check.kind === 'uuid' || check.extra?.format === 'uuid') {
          result.format = 'uuid'
        } else if (check.kind === 'email' || check.extra?.format === 'email') {
          result.format = 'email'
        } else if (check.kind === 'url' || check.extra?.format === 'uri' || check.extra?.format === 'url') {
          result.format = 'uri'
        } else if (check.kind === 'regex' && check.extra?.pattern instanceof RegExp) {
          result.pattern = check.extra.pattern.source
        } else if (check.kind === 'string_format' && typeof check.extra?.format === 'string') {
          result.format = check.extra.format
        } else if (check.kind === 'datetime' || check.extra?.format === 'date-time') {
          result.format = 'date-time'
        } else if (['length', 'len', 'exact_length'].includes(check.kind ?? '')) {
          if (typeof check.value === 'number') {
            result.minLength = check.value
            result.maxLength = check.value
          }
        } else if (check.kind === 'min' || check.kind === 'min_length') {
          if (typeof check.value === 'number') result.minLength = check.value
        } else if (check.kind === 'max' || check.kind === 'max_length') {
          if (typeof check.value === 'number') result.maxLength = check.value
        }
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodNumber:
    case 'number': {
      result.type = 'number'
      const checks = normalizeChecks(def.checks)
      for (const check of checks) {
        if (!check.kind) continue
        if (check.kind === 'int' || check.kind === 'isInteger') result.type = 'integer'
        if ((check.kind === 'min' || check.kind === 'gte') && typeof check.value === 'number') result.minimum = check.value
        if ((check.kind === 'max' || check.kind === 'lte') && typeof check.value === 'number') result.maximum = check.value
        if (check.kind === 'multipleOf' && typeof check.value === 'number') result.multipleOf = check.value
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodBigInt:
    case 'bigint':
      result.type = 'integer'
      result.format = 'int64'
      break
    case ZodFirstPartyTypeKind.ZodBoolean:
    case 'boolean':
      result.type = 'boolean'
      break
    case ZodFirstPartyTypeKind.ZodLiteral:
    case 'literal': {
      const value = def.value ?? (Array.isArray(def.values) ? def.values[0] : undefined)
      result.type = typeof value
      result.enum = [value]
      break
    }
    case ZodFirstPartyTypeKind.ZodEnum:
    case 'enum': {
      const entries = def.values ?? def.entries
      const values = Array.isArray(entries) ? entries : entries ? Object.values(entries) : []
      const enumerators = values.filter((v: unknown) => typeof v === 'string' || typeof v === 'number')
      const allString = enumerators.every((v: unknown) => typeof v === 'string')
      result.type = allString ? 'string' : 'number'
      result.enum = enumerators
      break
    }
    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      const values = Object.values(def.values).filter((v) => typeof v === 'string' || typeof v === 'number')
      const allString = values.every((v) => typeof v === 'string')
      result.type = allString ? 'string' : 'number'
      result.enum = values
      break
    }
    case ZodFirstPartyTypeKind.ZodUnion:
    case 'union': {
      const options = def.options || []
      result.oneOf = options.map((option: ZodTypeAny) => zodToJsonSchema(option, context) ?? {})
      break
    }
    case ZodFirstPartyTypeKind.ZodIntersection:
    case 'intersection': {
      result.allOf = [
        zodToJsonSchema(def.left, context) ?? {},
        zodToJsonSchema(def.right, context) ?? {},
      ]
      break
    }
    case ZodFirstPartyTypeKind.ZodPipeline:
    case 'pipe': {
      const resolved = zodToJsonSchema(def.out ?? def.innerType ?? def.schema, context) ?? {}
      Object.assign(result, resolved)
      break
    }
    case ZodFirstPartyTypeKind.ZodLazy:
    case 'lazy': {
      const next = typeof def.getter === 'function' ? def.getter() : undefined
      const resolved = next ? zodToJsonSchema(next, context) : undefined
      if (resolved) Object.assign(result, resolved)
      break
    }
    case ZodFirstPartyTypeKind.ZodPromise:
    case 'promise': {
      const resolved = zodToJsonSchema(def.type, context)
      if (resolved) Object.assign(result, resolved)
      break
    }
    case ZodFirstPartyTypeKind.ZodCatch:
    case 'catch': {
      const resolved = zodToJsonSchema(def.innerType ?? def.type, context)
      if (resolved) Object.assign(result, resolved)
      break
    }
    case ZodFirstPartyTypeKind.ZodReadonly:
    case 'readonly': {
      const resolved = zodToJsonSchema(def.innerType ?? def.type, context)
      if (resolved) Object.assign(result, resolved)
      break
    }
    case ZodFirstPartyTypeKind.ZodArray:
    case 'array': {
      const elementSchema =
        def.type && typeof def.type === 'object'
          ? def.type
          : (def.element && typeof def.element === 'object' ? def.element : undefined)
      result.type = 'array'
      result.items = zodToJsonSchema(elementSchema as ZodTypeAny, context) ?? {}
      if (typeof def.minLength === 'number') result.minItems = def.minLength
      if (typeof def.maxLength === 'number') result.maxItems = def.maxLength
      const checks = normalizeChecks(def.checks)
      for (const check of checks) {
        if (check.kind === 'min_length' && typeof check.value === 'number') result.minItems = check.value
        if (check.kind === 'max_length' && typeof check.value === 'number') result.maxItems = check.value
        if (check.kind === 'length' && typeof check.value === 'number') {
          result.minItems = check.value
          result.maxItems = check.value
        }
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodTuple:
    case 'tuple': {
      const items = def.items || []
      result.type = 'array'
      result.prefixItems = items.map((item: ZodTypeAny) => zodToJsonSchema(item, context) ?? {})
      result.minItems = items.length
      result.maxItems = items.length
      break
    }
    case ZodFirstPartyTypeKind.ZodRecord:
    case 'record': {
      result.type = 'object'
      result.additionalProperties = zodToJsonSchema(def.valueType ?? def.value, context) ?? {}
      break
    }
    case ZodFirstPartyTypeKind.ZodObject:
    case 'object': {
      result.type = 'object'
      const shape = getShape(def)
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []
      for (const [key, rawSchema] of Object.entries(shape)) {
        const unwrapped = unwrap(rawSchema as ZodTypeAny)
        const childSchema = zodToJsonSchema(unwrapped.schema, context)
        if (!childSchema) continue
        const baseSchema = childSchema
        let propertySchema: JsonSchema = baseSchema
        if (unwrapped.nullable) {
          propertySchema = {
            anyOf: [{ type: 'null' }, propertySchema],
          }
        }
        if (unwrapped.defaultValue !== undefined) {
          if (propertySchema === baseSchema) {
            propertySchema = { allOf: [baseSchema], default: unwrapped.defaultValue }
          } else {
            propertySchema = { ...propertySchema, default: unwrapped.defaultValue }
          }
        }
        properties[key] = propertySchema
        if (!unwrapped.optional) required.push(key)
      }
      result.properties = properties
      if (required.length > 0) result.required = required
      if (def.unknownKeys === 'passthrough') {
        result.additionalProperties = true
      } else if (def.catchall && resolveType(def.catchall._def) !== ZodFirstPartyTypeKind.ZodNever && resolveType(def.catchall._def) !== 'never') {
        result.additionalProperties = zodToJsonSchema(def.catchall, context) ?? true
      } else {
        result.additionalProperties = false
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodDate:
    case 'date':
      result.type = 'string'
      result.format = 'date-time'
      break
    case ZodFirstPartyTypeKind.ZodNull:
    case 'null':
      result.type = 'null'
      break
    case ZodFirstPartyTypeKind.ZodVoid:
    case 'void':
    case ZodFirstPartyTypeKind.ZodNever:
    case 'never':
      break
    case ZodFirstPartyTypeKind.ZodAny:
    case 'any':
    case ZodFirstPartyTypeKind.ZodUnknown:
    case 'unknown':
    case ZodFirstPartyTypeKind.ZodNaN:
    case 'nan':
    default:
      break
  }

  if (nullable) {
    if (result.type && result.type !== 'null') {
      result.nullable = true
    } else if (!result.type) {
      const clone = { ...result }
      result.anyOf = [{ type: 'null' }, clone]
    }
  }

  return result
}

function generateExample(schema?: ZodTypeAny, ctx?: ExampleGenerationContext): unknown {
  if (!schema) return undefined
  if ((typeof schema !== 'object' || schema === null) && typeof schema !== 'function') return undefined
  const trackable = schema as object
  const context: ExampleGenerationContext = ctx ?? { stack: new WeakSet<ZodTypeAny>() }
  if (context.stack.has(trackable as ZodTypeAny)) return undefined
  context.stack.add(trackable as ZodTypeAny)

  try {
    const { schema: inner, optional, nullable, defaultValue } = unwrap(schema)
    if (!inner) {
      if (defaultValue !== undefined) return defaultValue
      if (nullable) return null
      if (optional) return undefined
      return undefined
    }
    const def = (inner as any)._def
    const typeName = resolveType(def) as ZodFirstPartyTypeKind | string | undefined
    if (defaultValue !== undefined) return defaultValue

    if (nullable) return null
    if (optional) return undefined

    switch (typeName) {
      case ZodFirstPartyTypeKind.ZodString:
      case 'string': {
        const checks = normalizeChecks(def?.checks)
        for (const check of checks) {
          if (!check.kind && !check.extra?.format) continue
          if (check.kind === 'uuid' || check.extra?.format === 'uuid') return DEFAULT_EXAMPLE_VALUES.uuid
          if (check.kind === 'email' || check.extra?.format === 'email') return DEFAULT_EXAMPLE_VALUES.email
          if (check.kind === 'url' || check.extra?.format === 'url' || check.extra?.format === 'uri') return DEFAULT_EXAMPLE_VALUES.url
          if (check.kind === 'datetime' || check.extra?.format === 'date-time') return DEFAULT_EXAMPLE_VALUES.datetime
        }
        return DEFAULT_EXAMPLE_VALUES.string
      }
      case ZodFirstPartyTypeKind.ZodNumber:
      case 'number': {
        const checks = normalizeChecks(def?.checks)
        const isInt = checks.some((check) => check.kind === 'int' || check.kind === 'isInteger')
        return isInt ? DEFAULT_EXAMPLE_VALUES.integer : DEFAULT_EXAMPLE_VALUES.number
      }
      case ZodFirstPartyTypeKind.ZodBigInt:
      case 'bigint':
        return BigInt(1)
      case ZodFirstPartyTypeKind.ZodBoolean:
      case 'boolean':
        return DEFAULT_EXAMPLE_VALUES.boolean
      case ZodFirstPartyTypeKind.ZodEnum:
      case 'enum': {
        const entries = def?.values ?? def?.entries
        const values = Array.isArray(entries) ? entries : entries ? Object.values(entries) : []
        return values[0]
      }
      case ZodFirstPartyTypeKind.ZodNativeEnum: {
        const values = Object.values(def?.values || [])
        return values[0]
      }
      case ZodFirstPartyTypeKind.ZodLiteral:
      case 'literal':
        return def?.value ?? (Array.isArray(def?.values) ? def.values[0] : undefined)
      case ZodFirstPartyTypeKind.ZodArray:
      case 'array': {
        const child = generateExample(def?.type ?? def?.element, context)
        return child === undefined ? [] : [child]
      }
      case ZodFirstPartyTypeKind.ZodTuple:
      case 'tuple': {
        const items = def?.items || []
        return items.map((item: ZodTypeAny) => generateExample(item, context))
      }
      case ZodFirstPartyTypeKind.ZodObject:
      case 'object': {
        const shape = getShape(def)
        const obj: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(shape)) {
          const example = generateExample(value as ZodTypeAny, context)
          if (example !== undefined) obj[key] = example
        }
        return obj
      }
      case ZodFirstPartyTypeKind.ZodRecord:
      case 'record': {
        const valueExample = generateExample(def?.valueType ?? def?.value, context)
        return valueExample === undefined ? {} : { key: valueExample }
      }
      case ZodFirstPartyTypeKind.ZodUnion:
      case 'union': {
        const options = def?.options || []
        return options.length ? generateExample(options[0], context) : undefined
      }
      case ZodFirstPartyTypeKind.ZodPipeline:
      case 'pipe':
        return generateExample(def?.out ?? def?.innerType ?? def?.schema, context)
      case ZodFirstPartyTypeKind.ZodLazy:
      case 'lazy': {
        const next = typeof def?.getter === 'function' ? def.getter() : undefined
        return next ? generateExample(next, context) : undefined
      }
      case ZodFirstPartyTypeKind.ZodPromise:
      case 'promise':
        return generateExample(def?.type, context)
      case ZodFirstPartyTypeKind.ZodCatch:
      case 'catch':
        return generateExample(def?.innerType ?? def?.type, context)
      case ZodFirstPartyTypeKind.ZodReadonly:
      case 'readonly':
        return generateExample(def?.innerType ?? def?.type, context)
      case ZodFirstPartyTypeKind.ZodIntersection:
      case 'intersection': {
        const left = generateExample(def?.left, context)
        const right = generateExample(def?.right, context)
        if (typeof left === 'object' && left && typeof right === 'object' && right) {
          return { ...(left as object), ...(right as object) }
        }
        return left ?? right
      }
      case ZodFirstPartyTypeKind.ZodDate:
      case 'date':
        return DEFAULT_EXAMPLE_VALUES.datetime
      default:
        return undefined
    }
  } finally {
    context.stack.delete(trackable as ZodTypeAny)
  }
}

function buildParameters(
  schema: ZodTypeAny | undefined,
  location: ParameterLocation,
  pathParamNames?: PathParamInfo[]
): Array<Record<string, unknown>> {
  if (!schema && location !== 'path') return []

  const params: Array<Record<string, unknown>> = []

  if (location === 'path' && pathParamNames && pathParamNames.length) {
    const merged = mergePathParamSchemas(schema, pathParamNames)
    for (const { name, schema: paramSchema, optional } of merged) {
      const jsonSchema = zodToJsonSchema(paramSchema)
      const example = generateExample(paramSchema)
      params.push({
        name,
        in: 'path',
        required: !optional,
        schema: jsonSchema ?? { type: 'string' },
        example,
      })
    }
    return params
  }

  if (!schema) return params

  const { schema: unwrapped } = unwrap(schema)
  if (!unwrapped) return params
  const def = (unwrapped as any)._def
  const typeName = resolveType(def) as ZodFirstPartyTypeKind | string | undefined
  if (typeName === ZodFirstPartyTypeKind.ZodObject || typeName === 'object') {
    const shape = getShape(def)
    for (const [key, raw] of Object.entries(shape)) {
      const details = unwrap(raw as ZodTypeAny)
      if (!details.schema) continue
      const jsonSchema = zodToJsonSchema(details.schema)
      const example = generateExample(details.schema)
      params.push({
        name: key,
        in: location,
        required: location === 'path' ? true : !details.optional,
        schema: jsonSchema ?? {},
        example,
      })
    }
  } else {
    const jsonSchema = zodToJsonSchema(unwrapped)
    const example = generateExample(unwrapped)
    params.push({
      name: location === 'header' ? 'X-Custom-Header' : 'value',
      in: location,
      required: location === 'path',
      schema: jsonSchema ?? {},
      example,
    })
  }

  return params
}

function mergePathParamSchemas(schema: ZodTypeAny | undefined, params: PathParamInfo[]) {
  const merged: Array<{ name: string; schema: ZodTypeAny | undefined; optional: boolean }> = []
  const map: Record<string, ZodTypeAny> = {}
  if (schema) {
    const { schema: unwrapped } = unwrap(schema)
    if (unwrapped && (unwrapped as any)._def && (resolveType((unwrapped as any)._def) === ZodFirstPartyTypeKind.ZodObject || resolveType((unwrapped as any)._def) === 'object')) {
      const shape = getShape((unwrapped as any)._def)
      for (const [key, value] of Object.entries(shape)) {
        map[key] = value as ZodTypeAny
      }
    }
  }
  for (const param of params) {
    merged.push({
      name: param.name,
      schema: map[param.name],
      optional: !!param.optional,
    })
  }
  return merged
}

function buildRequestBody(request?: OpenApiRequestBodyDoc): Record<string, unknown> | undefined {
  if (!request) return undefined
  const schema = zodToJsonSchema(request.schema)
  const example = request.example ?? generateExample(request.schema)
  const contentType = request.contentType ?? 'application/json'
  return {
    required: true,
    content: {
      [contentType]: {
        schema: schema ?? {},
        example,
      },
    },
    description: request.description,
  }
}

function buildResponses(
  method: HttpMethod,
  responses?: OpenApiResponseDoc[],
  errors?: OpenApiResponseDoc[],
  metadata?: any
): Record<string, unknown> {
  const entries: Record<string, unknown> = {}
  const list = [...(responses ?? [])]
  const errorList = [...(errors ?? [])]
  if (metadata?.requireAuth) {
    errorList.push({
      status: 401,
      description: 'Unauthorized',
      schema: z.object({ error: z.string() }),
      xAutoGenerated: true,
    })
  }
  if (Array.isArray(metadata?.requireFeatures) && metadata.requireFeatures.length) {
    errorList.push({
      status: 403,
      description: 'Forbidden – missing required features',
      schema: z.object({ error: z.string() }),
      xAutoGenerated: true,
    })
  }
  if (!list.some((res) => res.status >= 200 && res.status < 300)) {
    const fallbackStatus = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200
    list.push({
      status: fallbackStatus,
      description: fallbackStatus === 204 ? 'Success' : 'Success response',
    })
  }
  for (const res of [...list, ...errorList]) {
    const status = String(res.status || 200)
    const mediaType = res.mediaType ?? 'application/json'
    const schema = res.schema ? zodToJsonSchema(res.schema) : undefined
    const example = res.schema ? res.example ?? generateExample(res.schema) : res.example
    const isNoContent = res.status === 204
    entries[status] = {
      description: res.description ?? '',
      ...(isNoContent
        ? {}
        : {
            content: {
              [mediaType]: {
                schema: schema ?? { type: 'object' },
                ...(example !== undefined ? { example } : {}),
              },
            },
          }),
      ...(res.xAutoGenerated ? { 'x-autoGenerated': true } : {}),
    }
  }
  return entries
}

function buildSecurity(metadata: any, methodDoc?: OpenApiMethodDoc, defaults?: string[]) {
  const securitySchemes = new Set<string>()
  if (Array.isArray(methodDoc?.security)) methodDoc.security.forEach((s) => securitySchemes.add(s))
  if (metadata?.requireAuth) securitySchemes.add('bearerAuth')
  if (defaults) defaults.forEach((s) => securitySchemes.add(s))
  if (securitySchemes.size === 0) return undefined
  return Array.from(securitySchemes.values()).map((scheme) => ({ [scheme]: [] }))
}

function collectExamples(
  querySchema?: ZodTypeAny,
  bodySchema?: ZodTypeAny,
  pathSchema?: ZodTypeAny,
  headerSchema?: ZodTypeAny,
  metadata?: any
): ExampleMap {
  const examples: ExampleMap = {}
  const queryExample = querySchema ? generateExample(querySchema) : undefined
  if (queryExample && typeof queryExample === 'object') examples.query = queryExample
  const bodyExample = bodySchema ? generateExample(bodySchema) : undefined
  if (bodyExample !== undefined) examples.body = bodyExample
  const pathExample = pathSchema ? generateExample(pathSchema) : undefined
  if (pathExample && typeof pathExample === 'object') examples.path = pathExample as Record<string, unknown>
  const headerExample = headerSchema ? generateExample(headerSchema) : undefined
  if (headerExample && typeof headerExample === 'object') examples.headers = headerExample as Record<string, unknown>
  if (metadata?.requireAuth) {
    if (!examples.headers) examples.headers = {}
    if (typeof examples.headers.authorization !== 'string') {
      examples.headers.authorization = 'Bearer <token>'
    }
  }
  return examples
}

function toFormUrlEncoded(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined) continue
    params.append(key, raw === null ? '' : String(raw))
  }
  return params.toString()
}

function stringifyBodyExample(value: unknown, mediaType?: string): string {
  if (value === undefined) return ''
  if (mediaType === 'application/x-www-form-urlencoded') {
    return toFormUrlEncoded(value)
  }
  if (!mediaType || mediaType === 'application/json') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildQueryString(example: unknown): string {
  if (!example || typeof example !== 'object') return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(example as Record<string, unknown>)) {
    if (value === undefined || value === null) continue
    const encoded = encodeURIComponent(String(value))
    parts.push(`${encodeURIComponent(key)}=${encoded}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

function injectPathExamples(path: string, params: PathParamInfo[], examples?: Record<string, unknown>): string {
  if (!params.length) return path
  let result = path
  for (const param of params) {
    const placeholder = `{${param.name}}`
    const example = examples && examples[param.name] !== undefined ? examples[param.name] : `:${param.name}`
    result = result.replace(placeholder, String(example))
  }
  return result
}

function buildCurlSample(
  method: HttpMethod,
  path: string,
  params: PathParamInfo[],
  examples: ExampleMap,
  baseUrl: string,
  metadata: any,
  requestBody?: OpenApiRequestBodyDoc
): string {
  const lines: string[] = []
  const pathWithExamples = injectPathExamples(path, params, examples.path)
  const query = buildQueryString(examples.query)
  const url = baseUrl.replace(/\/$/, '') + pathWithExamples + query
  lines.push(`curl -X ${method} "${url}"`)

  lines.push('  -H "Accept: application/json"')

  const headers: Record<string, unknown> = { ...(examples.headers ?? {}) }
  if (metadata?.requireAuth && !headers.Authorization && !headers.authorization) {
    headers.Authorization = 'Bearer <token>'
  }
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`  -H "${key.replace(/"/g, '')}: ${String(value).replace(/"/g, '')}"`)
  }

  const bodyExample = examples.body ?? requestBody?.example
  const requestContentType = requestBody?.contentType ?? 'application/json'
  if (bodyExample !== undefined) {
    lines.push(`  -H "Content-Type: ${requestContentType}"`)
    const serialized = stringifyBodyExample(bodyExample, requestContentType)
    if (serialized) lines.push(`  -d '${serialized.replace(/'/g, "\\'")}'`)
  }

  return lines.join(' \\\n')
}

function ensureSecurityComponents(doc: OpenApiDocument) {
  if (!doc.components) doc.components = {}
  if (!doc.components.securitySchemes) doc.components.securitySchemes = {}
  if (!doc.components.securitySchemes.bearerAuth) {
    doc.components.securitySchemes.bearerAuth = {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Send an `Authorization: Bearer <token>` header with a valid API token.',
    }
  }
}

function resolveOperationId(moduleId: string, path: string, method: HttpMethod): string {
  const cleaned = path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${moduleId}_${method.toLowerCase()}_${cleaned}`.replace(/__+/g, '_')
}

function collectRouteDoc(api: ModuleApi, moduleId: string): OpenApiRouteDoc | undefined {
  if ('handlers' in api) {
    const route = api as ModuleApiRouteFile & { docs?: OpenApiRouteDoc }
    if (route.docs) return route.docs
    const maybe = (route.handlers as any)?.openApi
    if (maybe && typeof maybe === 'object') return maybe as OpenApiRouteDoc
  } else {
    const legacy = api as ModuleApiLegacy & { docs?: OpenApiMethodDoc }
    if (legacy.docs) {
      return {
        methods: { [legacy.method]: legacy.docs },
      }
    }
    const maybe = (legacy.handler as any)?.openApi
    if (maybe && typeof maybe === 'object') {
      return {
        methods: { [legacy.method]: maybe as OpenApiMethodDoc },
      }
    }
  }
  return undefined
}

export function buildOpenApiDocument(modules: Module[], options: OpenApiDocumentOptions = {}): OpenApiDocument {
  const doc: OpenApiDocument = {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Open Mercato API',
      version: options.version ?? '1.0.0',
      description: options.description,
    },
    servers: options.servers,
    paths: {},
  }

  ensureSecurityComponents(doc)

  const tags = new Map<string, string | undefined>()

  for (const moduleEntry of modules) {
    const defaultTag = moduleEntry.info?.title ?? toTitle(moduleEntry.id)
    if (defaultTag) tags.set(defaultTag, moduleEntry.info?.description)

    const apis = moduleEntry.apis ?? []
    for (const api of apis) {
      const routeDoc = collectRouteDoc(api, moduleEntry.id)
      const moduleTag = routeDoc?.tag ?? defaultTag
      const normalized = normalizePath((api as any).path ?? (api as any).path ?? '')
      const pathKey = normalized.path
      if (!doc.paths[pathKey]) doc.paths[pathKey] = {}
      const availableMethods: HttpMethod[] =
        'handlers' in api
          ? HTTP_METHODS.filter((method) => typeof (api as ModuleApiRouteFile).handlers?.[method] === 'function')
          : [api.method as HttpMethod]

      for (const method of availableMethods) {
        const methodLower = method.toLowerCase() as Lowercase<HttpMethod>
        const existing = doc.paths[pathKey][methodLower]
        if (existing) continue

        const metadata = 'handlers' in api ? (api as ModuleApiRouteFile).metadata?.[method] : (api as ModuleApiLegacy).metadata
        const methodDoc = routeDoc?.methods?.[method]
        const summary = methodDoc?.summary ?? routeDoc?.summary ?? `${method} ${pathKey}`
        const baseDescription = methodDoc?.description ?? routeDoc?.description
        const requireFeatures = metadata?.requireFeatures
        const requireRoles = metadata?.requireRoles
        const descriptionParts: string[] = []
        if (baseDescription) descriptionParts.push(baseDescription)
        if (Array.isArray(requireFeatures) && requireFeatures.length) {
          descriptionParts.push(`Requires features: ${requireFeatures.join(', ')}`)
        }
        if (Array.isArray(requireRoles) && requireRoles.length) {
          descriptionParts.push(`Requires roles: ${requireRoles.join(', ')}`)
        }

        const querySchema = methodDoc?.query
        const pathSchema = methodDoc?.pathParams ?? routeDoc?.pathParams
        const headerSchema = methodDoc?.headers
        const requestBody = methodDoc?.requestBody
        const examples = collectExamples(querySchema, requestBody?.schema, pathSchema, headerSchema, metadata)
        const curlSample = buildCurlSample(
          method,
          pathKey,
          normalized.params,
          examples,
          options.baseUrlForExamples ?? 'https://api.open-mercato.local',
          metadata,
          requestBody
        )

        doc.paths[pathKey][methodLower] = {
          operationId: methodDoc?.operationId ?? resolveOperationId(moduleEntry.id, pathKey, method),
          summary,
          description: descriptionParts.length ? descriptionParts.join('\n\n') : undefined,
          tags: methodDoc?.tags ?? (moduleTag ? [moduleTag] : undefined),
          deprecated: methodDoc?.deprecated,
          externalDocs: methodDoc?.externalDocs,
          parameters: [
            ...buildParameters(pathSchema, 'path', normalized.params),
            ...buildParameters(querySchema, 'query'),
            ...buildParameters(headerSchema, 'header'),
          ].filter(Boolean),
          requestBody: buildRequestBody(requestBody),
          responses: buildResponses(method, methodDoc?.responses, methodDoc?.errors, metadata),
          security: buildSecurity(metadata, methodDoc, options.defaultSecurity),
          'x-codeSamples': methodDoc?.codeSamples ?? [
            {
              lang: 'curl',
              label: 'cURL',
              source: curlSample,
            },
          ],
          ...(Array.isArray(requireFeatures) && requireFeatures.length ? { 'x-require-features': requireFeatures } : {}),
          ...(Array.isArray(requireRoles) && requireRoles.length ? { 'x-require-roles': requireRoles } : {}),
          ...(metadata?.requireAuth ? { 'x-require-auth': true } : {}),
          ...(methodDoc?.extensions ?? {}),
        }
      }
    }
  }

  doc.tags = Array.from(tags.entries()).map(([name, description]) => ({
    name,
    description: description ?? undefined,
  }))

  return doc
}

function formatMarkdownTable(rows: Array<[string, string, string, string]>): string {
  if (!rows.length) return ''
  const header = ['Name', 'Location', 'Type', 'Description']
  const align = ['---', '---', '---', '---']
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${align.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ]
  return lines.join('\n')
}

function schemaTypeLabel(schema: any): string {
  if (!schema) return 'any'
  if (schema.type) return schema.type
  if (schema.oneOf) return schema.oneOf.map(schemaTypeLabel).join(' | ')
  if (schema.allOf) return schema.allOf.map(schemaTypeLabel).join(' & ')
  return 'any'
}

function schemaHasDetails(schema: any): boolean {
  if (!schema || typeof schema !== 'object') return false
  if (Array.isArray(schema.enum) && schema.enum.length) return true
  if (schema.const !== undefined) return true
  if (typeof schema.format === 'string') return true
  if (Array.isArray(schema.oneOf) && schema.oneOf.some((s) => schemaHasDetails(s))) return true
  if (Array.isArray(schema.anyOf) && schema.anyOf.some((s) => schemaHasDetails(s))) return true
  if (Array.isArray(schema.allOf) && schema.allOf.some((s) => schemaHasDetails(s))) return true
  if (schema.items && schemaHasDetails(schema.items)) return true
  if (schema.properties && Object.keys(schema.properties).length) return true
  if (Array.isArray(schema.prefixItems) && schema.prefixItems.some((s) => schemaHasDetails(s))) return true
  if (schema.type && schema.type !== 'object') return true
  return false
}

type ContentSelection = {
  mediaType: string
  entry: any
}

type DisplaySnippet = {
  value: string
  language: string
}

function selectContentVariant(content?: Record<string, any>): ContentSelection | undefined {
  if (!content) return undefined
  const entries = Object.entries(content)
  if (!entries.length) return undefined
  const preferred = [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
  ]
  for (const mediaType of preferred) {
    const match = entries.find(([type]) => type === mediaType)
    if (match) {
      const [selectedType, entry] = match
      return { mediaType: selectedType, entry }
    }
  }
  const [mediaType, entry] = entries[0]
  return { mediaType, entry }
}

function formatExampleForDisplay(example: unknown, mediaType?: string): DisplaySnippet | null {
  if (example === undefined) return null
  if (mediaType === 'application/x-www-form-urlencoded') {
    const encoded = toFormUrlEncoded(example)
    if (!encoded) return null
    return { value: encoded, language: 'text' }
  }
  if (mediaType === 'multipart/form-data') {
    if (example && typeof example === 'object') {
      const lines = Object.entries(example as Record<string, unknown>).map(([key, value]) => {
        const rendered = value === undefined || value === null ? '' : String(value)
        return `${key}=${rendered}`
      })
      if (lines.length) {
        return { value: lines.join('\n'), language: 'text' }
      }
    }
    if (typeof example === 'string') {
      return { value: example, language: 'text' }
    }
  }
  if (!mediaType || mediaType === 'application/json') {
    try {
      return { value: JSON.stringify(example, null, 2), language: 'json' }
    } catch {
      return null
    }
  }
  if (typeof example === 'string') {
    return { value: example, language: 'text' }
  }
  try {
    return { value: JSON.stringify(example, null, 2), language: 'json' }
  } catch {
    return { value: String(example), language: 'text' }
  }
}

function formatSchemaForDisplay(schema: any): DisplaySnippet | null {
  if (!schema) return null
  try {
    return { value: JSON.stringify(schema, null, 2), language: 'json' }
  } catch {
    return null
  }
}

export function generateMarkdownFromOpenApi(doc: OpenApiDocument): string {
  const lines: string[] = []
  lines.push(`# ${doc.info.title}`)
  lines.push('')
  lines.push(`Version: ${doc.info.version}`)
  if (doc.info.description) {
    lines.push('')
    lines.push(doc.info.description)
  }
  if (doc.servers && doc.servers.length) {
    lines.push('')
    lines.push('## Servers')
    for (const server of doc.servers) {
      lines.push(`- ${server.url}${server.description ? ` – ${server.description}` : ''}`)
    }
  }

  const sortedPaths = Object.keys(doc.paths).sort()
  for (const path of sortedPaths) {
    const operations = doc.paths[path]
    const methods = Object.keys(operations).sort()
    for (const method of methods) {
      const op: any = operations[method]
      lines.push('')
      lines.push(`## ${method.toUpperCase()} \`${path}\``)
      if (op.summary) {
        lines.push('')
        lines.push(op.summary)
      }
      if (op.description) {
        lines.push('')
        lines.push(op.description)
      }
      if (op.tags && op.tags.length) {
        lines.push('')
        lines.push(`**Tags:** ${op.tags.join(', ')}`)
      }
      if (op['x-require-auth']) {
        lines.push('')
        lines.push(`**Requires authentication.**`)
      }
      if (op['x-require-features']) {
        lines.push('')
        lines.push(`**Features:** ${(op['x-require-features'] as string[]).join(', ')}`)
      }
      if (op['x-require-roles']) {
        lines.push('')
        lines.push(`**Roles:** ${(op['x-require-roles'] as string[]).join(', ')}`)
      }

      const parameters = (op.parameters as any[]) ?? []
      if (parameters.length) {
        lines.push('')
        lines.push('### Parameters')
        const rows: Array<[string, string, string, string]> = parameters.map((p) => [
          p.name,
          p.in,
          schemaTypeLabel(p.schema),
          p.required ? 'Required' : 'Optional',
        ])
        lines.push(formatMarkdownTable(rows))
      }

      if (op.requestBody) {
        const selection = selectContentVariant(op.requestBody.content)
        if (selection) {
          const { mediaType, entry } = selection
          const example = entry?.example ?? entry?.examples?.default?.value
          const formatted = formatExampleForDisplay(example, mediaType)
          const schemaFormatted =
            entry?.schema && schemaHasDetails(entry.schema) ? formatSchemaForDisplay(entry.schema) : null
          lines.push('')
          lines.push('### Request Body')
          lines.push('')
          lines.push(`Content-Type: \`${mediaType}\``)
          if (formatted) {
            lines.push('')
            lines.push(`\`\`\`${formatted.language}`)
            lines.push(formatted.value)
            lines.push('```')
          } else if (schemaFormatted) {
            lines.push('')
            lines.push(`\`\`\`${schemaFormatted.language}`)
            lines.push(schemaFormatted.value)
            lines.push('```')
          } else {
            lines.push('')
            lines.push('No example available for this content type.')
          }
        }
      }

      const responses = op.responses ?? {}
      const responseStatuses = Object.keys(responses).sort()
      if (responseStatuses.length) {
        lines.push('')
        lines.push('### Responses')
        for (const status of responseStatuses) {
          const response = responses[status]
          if (response?.['x-autoGenerated']) continue
          lines.push('')
          lines.push(`**${status}** – ${response.description || 'Response'}`)
          const selection = selectContentVariant(response.content)
          if (selection) {
            const { mediaType, entry } = selection
            const example = entry?.example ?? entry?.examples?.default?.value
            const formatted = formatExampleForDisplay(example, mediaType)
            const schemaFormatted =
              entry?.schema && schemaHasDetails(entry.schema) ? formatSchemaForDisplay(entry.schema) : null
            lines.push('')
            lines.push(`Content-Type: \`${mediaType}\``)
            if (formatted) {
              lines.push('')
              lines.push(`\`\`\`${formatted.language}`)
              lines.push(formatted.value)
              lines.push('```')
            } else if (schemaFormatted) {
              lines.push('')
              lines.push(`\`\`\`${schemaFormatted.language}`)
              lines.push(schemaFormatted.value)
              lines.push('```')
            }
          }
        }
      }

      const samples = op['x-codeSamples'] as any[] | undefined
      if (samples && samples.length) {
        const curl = samples.find((sample) => String(sample.lang).toLowerCase() === 'curl') ?? samples[0]
        if (curl?.source) {
          lines.push('')
          lines.push('### Example')
          lines.push('')
          lines.push('```bash')
          lines.push(curl.source)
          lines.push('```')
        }
      }
    }
  }

  return lines.join('\n')
}
