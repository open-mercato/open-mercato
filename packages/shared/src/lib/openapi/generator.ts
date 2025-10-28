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

type ExampleMap = {
  query?: unknown
  body?: unknown
  path?: Record<string, unknown>
  headers?: Record<string, unknown>
}

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

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
    const typeName = def.typeName
    if (typeName === ZodFirstPartyTypeKind.ZodOptional) {
      optional = true
      current = (current as any)._def.innerType
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodNullable) {
      nullable = true
      current = (current as any)._def.innerType
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodDefault) {
      optional = true
      defaultValue = (current as any)._def.defaultValue()
      current = (current as any)._def.innerType
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodEffects) {
      current = (current as any)._def.schema
      continue
    }
    if (typeName === ZodFirstPartyTypeKind.ZodBranded) {
      current = (current as any)._def.type
      continue
    }
    break
  }
  return { schema: current, optional, nullable, defaultValue }
}

function zodToJsonSchema(schema?: ZodTypeAny): JsonSchema | undefined {
  if (!schema) return undefined
  const { schema: inner, nullable } = unwrap(schema)
  if (!inner) return undefined
  const def = (inner as any)._def
  if (!def) return undefined
  const typeName = def.typeName as ZodFirstPartyTypeKind

  let result: JsonSchema

  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString: {
      result = { type: 'string' }
      const checks = def.checks || []
      for (const check of checks) {
        if (check.kind === 'uuid') result.format = 'uuid'
        else if (check.kind === 'email') result.format = 'email'
        else if (check.kind === 'url') result.format = 'uri'
        else if (check.kind === 'regex' && check.regex instanceof RegExp) {
          result.pattern = check.regex.source
        } else if (check.kind === 'datetime') {
          result.format = 'date-time'
        } else if (check.kind === 'length' || check.kind === 'min' || check.kind === 'max') {
          if (typeof check.value === 'number') {
            const key = check.kind === 'length' ? 'minLength' : (check.kind === 'min' ? 'minLength' : 'maxLength')
            result[key] = check.value
          }
        }
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodNumber: {
      result = { type: 'number' }
      const checks = def.checks || []
      for (const check of checks) {
        if (check.kind === 'int') result.type = 'integer'
        if (check.kind === 'min') result.minimum = check.value
        if (check.kind === 'max') result.maximum = check.value
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodBigInt:
      result = { type: 'integer', format: 'int64' }
      break
    case ZodFirstPartyTypeKind.ZodBoolean:
      result = { type: 'boolean' }
      break
    case ZodFirstPartyTypeKind.ZodLiteral: {
      const value = def.value
      result = { type: typeof value, enum: [value] }
      break
    }
    case ZodFirstPartyTypeKind.ZodEnum:
      result = { type: 'string', enum: def.values.slice() }
      break
    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      const values = Object.values(def.values).filter((v) => typeof v === 'string' || typeof v === 'number')
      const allString = values.every((v) => typeof v === 'string')
      result = { type: allString ? 'string' : 'number', enum: values }
      break
    }
    case ZodFirstPartyTypeKind.ZodUnion: {
      const options = def.options || []
      result = { oneOf: options.map((option: ZodTypeAny) => zodToJsonSchema(option) ?? {}) }
      break
    }
    case ZodFirstPartyTypeKind.ZodIntersection: {
      result = { allOf: [zodToJsonSchema(def.left), zodToJsonSchema(def.right)] }
      break
    }
    case ZodFirstPartyTypeKind.ZodArray: {
      result = {
        type: 'array',
        items: zodToJsonSchema(def.type) ?? {},
      }
      if (typeof def.minLength === 'number') result.minItems = def.minLength
      if (typeof def.maxLength === 'number') result.maxItems = def.maxLength
      break
    }
    case ZodFirstPartyTypeKind.ZodTuple: {
      const items = def.items || []
      result = {
        type: 'array',
        prefixItems: items.map((item: ZodTypeAny) => zodToJsonSchema(item) ?? {}),
        minItems: items.length,
        maxItems: items.length,
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodRecord: {
      result = {
        type: 'object',
        additionalProperties: zodToJsonSchema(def.valueType) ?? {},
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodObject: {
      const shape = def.shape()
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []
      for (const [key, rawSchema] of Object.entries(shape)) {
        const unwrapped = unwrap(rawSchema as ZodTypeAny)
        const childSchema = zodToJsonSchema(unwrapped.schema)
        if (!childSchema) continue
        if (unwrapped.nullable) childSchema.nullable = true
        if (unwrapped.defaultValue !== undefined) childSchema.default = unwrapped.defaultValue
        properties[key] = childSchema
        if (!unwrapped.optional) required.push(key)
      }
      result = {
        type: 'object',
        properties,
      }
      if (required.length > 0) result.required = required
      if (def.unknownKeys === 'passthrough') {
        result.additionalProperties = true
      } else if (def.catchall && def.catchall._def.typeName !== ZodFirstPartyTypeKind.ZodNever) {
        result.additionalProperties = zodToJsonSchema(def.catchall) ?? true
      } else {
        result.additionalProperties = false
      }
      break
    }
    case ZodFirstPartyTypeKind.ZodDate:
      result = { type: 'string', format: 'date-time' }
      break
    case ZodFirstPartyTypeKind.ZodNull:
      result = { type: 'null' }
      break
    case ZodFirstPartyTypeKind.ZodVoid:
    case ZodFirstPartyTypeKind.ZodNever:
      result = {}
      break
    case ZodFirstPartyTypeKind.ZodAny:
    case ZodFirstPartyTypeKind.ZodUnknown:
    case ZodFirstPartyTypeKind.ZodNaN:
    default:
      result = {}
      break
  }

  if (nullable && result) {
    if (result.type && result.type !== 'null') {
      result.nullable = true
    } else if (!result.type) {
      result.anyOf = [{ type: 'null' }, { ...result }]
    }
  }

  return result
}

function generateExample(schema?: ZodTypeAny): unknown {
  if (!schema) return undefined
  const { schema: inner, optional, nullable, defaultValue } = unwrap(schema)
  const typeName = (inner as any)._def?.typeName as ZodFirstPartyTypeKind | undefined
  if (defaultValue !== undefined) return defaultValue

  if (nullable) return null
  if (optional) return undefined

  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString: {
      const checks = (inner as any)._def?.checks || []
      for (const check of checks) {
        if (check.kind === 'uuid') return DEFAULT_EXAMPLE_VALUES.uuid
        if (check.kind === 'email') return DEFAULT_EXAMPLE_VALUES.email
        if (check.kind === 'url') return DEFAULT_EXAMPLE_VALUES.url
        if (check.kind === 'datetime') return DEFAULT_EXAMPLE_VALUES.datetime
      }
      return DEFAULT_EXAMPLE_VALUES.string
    }
    case ZodFirstPartyTypeKind.ZodNumber: {
      const checks = (inner as any)._def?.checks || []
      const isInt = checks.some((check: any) => check.kind === 'int')
      return isInt ? DEFAULT_EXAMPLE_VALUES.integer : DEFAULT_EXAMPLE_VALUES.number
    }
    case ZodFirstPartyTypeKind.ZodBigInt:
      return BigInt(1)
    case ZodFirstPartyTypeKind.ZodBoolean:
      return DEFAULT_EXAMPLE_VALUES.boolean
    case ZodFirstPartyTypeKind.ZodEnum: {
      const values = (inner as any)._def?.values || []
      return values[0]
    }
    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      const values = Object.values((inner as any)._def?.values || [])
      return values[0]
    }
    case ZodFirstPartyTypeKind.ZodLiteral:
      return (inner as any)._def?.value
    case ZodFirstPartyTypeKind.ZodArray: {
      const child = generateExample((inner as any)._def?.type)
      return child === undefined ? [] : [child]
    }
    case ZodFirstPartyTypeKind.ZodTuple: {
      const items = (inner as any)._def?.items || []
      return items.map((item: ZodTypeAny) => generateExample(item))
    }
    case ZodFirstPartyTypeKind.ZodObject: {
      const shape = (inner as any)._def?.shape?.() || {}
      const obj: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(shape)) {
        const example = generateExample(value as ZodTypeAny)
        if (example !== undefined) obj[key] = example
      }
      return obj
    }
    case ZodFirstPartyTypeKind.ZodRecord: {
      const valueExample = generateExample((inner as any)._def?.valueType)
      return valueExample === undefined ? {} : { key: valueExample }
    }
    case ZodFirstPartyTypeKind.ZodUnion: {
      const options = (inner as any)._def?.options || []
      return options.length ? generateExample(options[0]) : undefined
    }
    case ZodFirstPartyTypeKind.ZodIntersection: {
      const left = generateExample((inner as any)._def?.left)
      const right = generateExample((inner as any)._def?.right)
      if (typeof left === 'object' && left && typeof right === 'object' && right) {
        return { ...(left as object), ...(right as object) }
      }
      return left ?? right
    }
    case ZodFirstPartyTypeKind.ZodDate:
      return DEFAULT_EXAMPLE_VALUES.datetime
    default:
      return undefined
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
  const typeName = (unwrapped as any)._def?.typeName as ZodFirstPartyTypeKind | undefined
  if (typeName === ZodFirstPartyTypeKind.ZodObject) {
    const shape = (unwrapped as any)._def?.shape?.() || {}
    for (const [key, raw] of Object.entries(shape)) {
      const details = unwrap(raw as ZodTypeAny)
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
    if ((unwrapped as any)._def?.typeName === ZodFirstPartyTypeKind.ZodObject) {
      const shape = (unwrapped as any)._def?.shape?.() || {}
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
    })
  }
  if (Array.isArray(metadata?.requireFeatures) && metadata.requireFeatures.length) {
    errorList.push({
      status: 403,
      description: 'Forbidden – missing required features',
      schema: z.object({ error: z.string() }),
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

function stringifyBodyExample(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
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
  if (bodyExample !== undefined) {
    lines.push('  -H "Content-Type: application/json"')
    const serialized = stringifyBodyExample(bodyExample)
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

function formatJsonExample(example: unknown): string | null {
  if (example === undefined) return null
  try {
    return JSON.stringify(example, null, 2)
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
        const content = op.requestBody.content?.['application/json']
        const example = content?.example ?? content?.examples?.default?.value
        const formatted = formatJsonExample(example)
        lines.push('')
        lines.push('### Request Body')
        if (formatted) {
          lines.push('')
          lines.push('```json')
          lines.push(formatted)
          lines.push('```')
        } else {
          lines.push('')
          lines.push('`application/json`')
        }
      }

      const responses = op.responses ?? {}
      const responseStatuses = Object.keys(responses).sort()
      if (responseStatuses.length) {
        lines.push('')
        lines.push('### Responses')
        for (const status of responseStatuses) {
          const response = responses[status]
          lines.push('')
          lines.push(`**${status}** – ${response.description || 'Response'}`)
          const content = response.content?.['application/json']
          const example = content?.example ?? content?.examples?.default?.value
          const formatted = formatJsonExample(example)
          if (formatted) {
            lines.push('')
            lines.push('```json')
            lines.push(formatted)
            lines.push('```')
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
