#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  astToString,
  COMMENT_HEADER,
  resolveRef,
  scanDiscriminators,
  transformSchema,
  type GlobalContext,
  type OpenAPITSOptions,
} from 'openapi-typescript'
import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { modules } from '../generated/modules.generated'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const clientRoot = path.join(repoRoot, 'packages/client')
const generatedDir = path.join(clientRoot, 'src/generated')
const typesOutputPath = path.join(generatedDir, 'openapi.types.ts')

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true })
}

async function writeIfChanged(filePath: string, content: string) {
  try {
    const existing = await readFile(filePath, 'utf8')
    if (existing === content) return false
  } catch {
    // Ignore missing file
  }
  await writeFile(filePath, content, 'utf8')
  return true
}

function resolveBaseUrl(): string {
  return (
    process.env.OPEN_MERCATO_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.APP_URL ||
    'http://localhost:3000/api'
  )
}

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
  const base = cleaned.length ? cleaned : `Schema${fallbackIndex}`
  return base
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

export function sanitizeOpenApiDocument(doc: any): any {
  const schemaNameMap = new Map<object, string>()
  const schemas: Record<string, JsonValue> = doc.components?.schemas ?? {}
  if (!doc.components) doc.components = {}
  doc.components.schemas = schemas
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

async function main() {
  await ensureDir(generatedDir)
  const rawDoc = buildOpenApiDocument(modules, {
    title: 'Open Mercato API',
    version: '1.0.0',
    description: 'Auto-generated OpenAPI document for all enabled modules.',
    servers: [{ url: resolveBaseUrl(), description: 'Default environment' }],
    baseUrlForExamples: resolveBaseUrl(),
    defaultSecurity: ['bearerAuth'],
  })
  const doc = sanitizeOpenApiDocument(rawDoc)

  const header = '// AUTO-GENERATED by scripts/generate-api-client.ts -- DO NOT EDIT\n'
  const tsOptions: OpenAPITSOptions = {
    alphabetize: true,
    defaultNonNullable: false,
    arrayLength: false,
  }
  const ctx: GlobalContext = {
    additionalProperties: tsOptions.additionalProperties ?? false,
    alphabetize: tsOptions.alphabetize ?? false,
    arrayLength: tsOptions.arrayLength ?? false,
    defaultNonNullable: tsOptions.defaultNonNullable ?? true,
    discriminators: scanDiscriminators(doc, tsOptions),
    emptyObjectsUnknown: tsOptions.emptyObjectsUnknown ?? false,
    enum: tsOptions.enum ?? false,
    enumValues: tsOptions.enumValues ?? false,
    dedupeEnums: tsOptions.dedupeEnums ?? false,
    excludeDeprecated: tsOptions.excludeDeprecated ?? false,
    exportType: tsOptions.exportType ?? false,
    immutable: tsOptions.immutable ?? false,
    rootTypes: tsOptions.rootTypes ?? false,
    rootTypesNoSchemaPrefix: tsOptions.rootTypesNoSchemaPrefix ?? false,
    injectFooter: [],
    pathParamsAsTypes: tsOptions.pathParamsAsTypes ?? false,
    postTransform: typeof tsOptions.postTransform === 'function' ? tsOptions.postTransform : undefined,
    propertiesRequiredByDefault: tsOptions.propertiesRequiredByDefault ?? false,
    redoc: undefined as any,
    silent: tsOptions.silent ?? false,
    inject: tsOptions.inject,
    transform: typeof tsOptions.transform === 'function' ? tsOptions.transform : undefined,
    transformProperty: typeof tsOptions.transformProperty === 'function' ? tsOptions.transformProperty : undefined,
    makePathsEnum: tsOptions.makePathsEnum ?? false,
    generatePathParams: tsOptions.generatePathParams ?? false,
    resolve($ref: string) {
      return resolveRef(doc as any, $ref, { silent: tsOptions.silent ?? false })
    },
  }
  const ast = transformSchema(doc as any, ctx)
  const printed = astToString(ast)
  const typeSerialized = `${header}${COMMENT_HEADER}${printed.trimEnd()}\n`
  const wroteTypes = await writeIfChanged(typesOutputPath, typeSerialized)

  if (wroteTypes) {
    console.log('[api-client] generated OpenAPI artifacts')
  } else {
    console.log('[api-client] OpenAPI artifacts already up to date')
  }
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch((error) => {
    console.error('[api-client] Failed to generate client artifacts:', error)
    process.exitCode = 1
  })
}
