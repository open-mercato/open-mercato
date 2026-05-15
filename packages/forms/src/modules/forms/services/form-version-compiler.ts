import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { ValidateFunction } from 'ajv'
import { z } from 'zod'
import {
  FieldTypeRegistry,
  defaultFieldTypeRegistry,
} from '../schema/field-type-registry'
import {
  OM_FIELD_KEYWORDS,
  OM_FIELD_VALIDATORS,
  OM_ROOT_KEYWORDS,
  OM_ROOT_VALIDATORS,
  addOmKeywords,
  validateOmCrossKeyword,
  type OmExtensionViolation,
  type OmValidationMessages,
} from '../schema/jsonschema-extensions'
import {
  compileFieldValidationRules,
  type ValidationRules,
} from './field-validation-service'
import type { FieldNode } from '../backend/forms/[id]/studio/schema-helpers'

// ============================================================================
// Public types
// ============================================================================

export type FieldDescriptor = {
  /** Field key under `schema.properties`. */
  key: string
  /** OM type from `x-om-type`. */
  type: string
  /** Section key when the field belongs to one (from `x-om-sections[].fieldKeys`). */
  sectionKey: string | null
  /** Sensitivity flag — phase 1c uses this for log redaction. */
  sensitive: boolean
  /** Roles permitted to write the field. */
  editableBy: string[]
  /** Roles permitted to read the field. */
  visibleTo: string[]
  /** Whether the field is required by `schema.required`. */
  required: boolean
  /**
   * Compiled validation rules surfaced to the runtime (Tier-2 spec MUST 15).
   * The studio preview, the public runner, and the submission service all
   * read from this array — never from the raw `x-om-*` keywords.
   */
  validations: ValidationRules
  /**
   * Locale-specific message overrides for the validation rules above.
   * `messages[locale][ruleType]` resolves to a localised string; missing
   * locales fall back through `en` to the generic English defaults inside
   * `field-validation-service`.
   */
  validationMessages?: OmValidationMessages
}

/**
 * Default-applied view of an `OmSection`. The compiler never writes these
 * defaults back to the persisted schema (Decision 9 / R-9 mitigation).
 */
export type ResolvedSectionView = {
  key: string
  title: Record<string, string>
  fieldKeys: string[]
  kind: 'page' | 'section' | 'ending'
  columns: 1 | 2 | 3 | 4
  gap: 'sm' | 'md' | 'lg'
  divider: boolean
  hideTitle: boolean
}

/**
 * One page of the implicit-Page-1 partition (Decisions 2a / 2b). The
 * compiler exposes `partitionPages` so the studio canvas and the eventual
 * paginated runner agree on the page boundaries derived from a flat
 * `x-om-sections` list.
 */
export type ResolvedPage = {
  /** Section keys belonging to this page, in declaration order. */
  sectionKeys: string[]
}

export type RolePolicyLookup = (
  role: string,
  fieldKey: string
) => { canRead: boolean; canWrite: boolean }

export type CompiledFormVersion = {
  /** SHA-256 of canonicalized `{ schema, ui_schema }`. */
  schemaHash: string
  /** Compiled AJV validator — root validator for the whole submission shape. */
  ajv: ValidateFunction
  /** Zod mirror — used by API routes / commands for typed input shaping. */
  zod: z.ZodTypeAny
  /** Flat lookup of field metadata by key. */
  fieldIndex: Record<string, FieldDescriptor>
  /** Role-aware read/write predicate. */
  rolePolicyLookup: RolePolicyLookup
  /** Snapshot of the field-type registry version at compile time. */
  registryVersion: string
}

// ============================================================================
// Error type
// ============================================================================

export type FormCompilationErrorCode =
  | 'MISSING_TYPE'
  | 'UNKNOWN_TYPE'
  | 'ROLE_NOT_DECLARED'
  | 'INVALID_REGEX_PATTERN'
  | 'INVALID_EXTENSION'
  | 'AJV_COMPILE_FAILED'
  | 'INVALID_SCHEMA_SHAPE'

export class FormCompilationError extends Error {
  readonly code: FormCompilationErrorCode
  readonly path: string[]

  constructor(code: FormCompilationErrorCode, message: string, path: string[]) {
    super(message)
    this.name = 'FormCompilationError'
    this.code = code
    this.path = path
  }
}

// ============================================================================
// Compiler
// ============================================================================

export type FormVersionCompilerOptions = {
  registry?: FieldTypeRegistry
  cacheMax?: number
}

export type FormVersionCompileInput = {
  id: string
  updatedAt: Date
  schema: unknown
  uiSchema: unknown
}

const DEFAULT_CACHE_MAX = (() => {
  const raw = process.env.FORMS_COMPILER_CACHE_MAX
  if (!raw) return 200
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200
})()

export class FormVersionCompiler {
  private readonly registry: FieldTypeRegistry
  private readonly cacheMax: number
  private readonly cache = new Map<string, CompiledFormVersion>()

  constructor(options: FormVersionCompilerOptions = {}) {
    this.registry = options.registry ?? defaultFieldTypeRegistry
    this.cacheMax = options.cacheMax ?? DEFAULT_CACHE_MAX
  }

  compile(input: FormVersionCompileInput): CompiledFormVersion {
    const cacheKey = `${input.id}:${input.updatedAt.toISOString()}`
    const cached = this.cache.get(cacheKey)
    if (cached) {
      // Refresh LRU position on hit.
      this.cache.delete(cacheKey)
      this.cache.set(cacheKey, cached)
      return cached
    }

    const compiled = this.compileFresh(input)
    this.evictIfFull()
    this.cache.set(cacheKey, compiled)
    return compiled
  }

  /**
   * Drop the cache. Useful for tests and for downstream phases when the
   * registry mutates (rare — registry version changes invalidate compiles
   * naturally because they reach the snapshot, but a hard reset is cheap).
   */
  resetCache(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private compileFresh(input: FormVersionCompileInput): CompiledFormVersion {
    const schema = assertObject(input.schema, ['schema'], 'INVALID_SCHEMA_SHAPE')
    const uiSchema = assertObject(input.uiSchema, ['uiSchema'], 'INVALID_SCHEMA_SHAPE')

    const declaredRoles = readDeclaredRoles(schema)
    validateRootExtensions(schema, declaredRoles)

    const crossKeywordViolation = validateOmCrossKeyword(schema)
    if (crossKeywordViolation) {
      throw new FormCompilationError('INVALID_EXTENSION', crossKeywordViolation, [])
    }

    const properties = readProperties(schema)
    const requiredFields = readRequired(schema)
    const sections = readSections(schema)
    const sectionByField = buildSectionLookup(sections)

    const fieldIndex: Record<string, FieldDescriptor> = {}
    for (const [fieldKey, rawNode] of properties) {
      const fieldNode = assertObject(rawNode, ['properties', fieldKey], 'INVALID_SCHEMA_SHAPE')
      validateFieldExtensions(fieldNode, ['properties', fieldKey])

      const omType = fieldNode[OM_FIELD_KEYWORDS.type]
      if (typeof omType !== 'string' || omType.length === 0) {
        throw new FormCompilationError(
          'MISSING_TYPE',
          `Field "${fieldKey}" must declare an "${OM_FIELD_KEYWORDS.type}" string keyword.`,
          ['properties', fieldKey],
        )
      }
      if (!this.registry.has(omType)) {
        throw new FormCompilationError(
          'UNKNOWN_TYPE',
          `Field "${fieldKey}" declares unregistered type "${omType}". Register it with the FieldTypeRegistry first.`,
          ['properties', fieldKey, OM_FIELD_KEYWORDS.type],
        )
      }
      if (typeof fieldNode.type !== 'string' && !Array.isArray(fieldNode.type)) {
        throw new FormCompilationError(
          'INVALID_SCHEMA_SHAPE',
          `Field "${fieldKey}" must declare a JSON Schema "type" keyword.`,
          ['properties', fieldKey, 'type'],
        )
      }
      if (typeof fieldNode.pattern === 'string') {
        try {
          // Throws on invalid regex source.

          new RegExp(fieldNode.pattern)
        } catch {
          throw new FormCompilationError(
            'INVALID_REGEX_PATTERN',
            `Field "${fieldKey}" has an invalid regular expression pattern.`,
            ['properties', fieldKey, 'pattern'],
          )
        }
      }

      const editableBy = readStringArray(fieldNode, OM_FIELD_KEYWORDS.editableBy, ['admin'])
      const visibleTo = readStringArray(
        fieldNode,
        OM_FIELD_KEYWORDS.visibleTo,
        unique([...editableBy, 'admin']),
      )

      for (const role of editableBy) {
        if (!declaredRoles.includes(role) && role !== 'admin') {
          throw new FormCompilationError(
            'ROLE_NOT_DECLARED',
            `Field "${fieldKey}" declares editable-by role "${role}" which is not in x-om-roles.`,
            ['properties', fieldKey, OM_FIELD_KEYWORDS.editableBy],
          )
        }
      }
      for (const role of visibleTo) {
        if (!declaredRoles.includes(role) && role !== 'admin') {
          throw new FormCompilationError(
            'ROLE_NOT_DECLARED',
            `Field "${fieldKey}" declares visible-to role "${role}" which is not in x-om-roles.`,
            ['properties', fieldKey, OM_FIELD_KEYWORDS.visibleTo],
          )
        }
      }

      const validations = compileFieldValidationRules(fieldNode as unknown as FieldNode, omType)
      const validationMessages = readValidationMessages(fieldNode)

      fieldIndex[fieldKey] = {
        key: fieldKey,
        type: omType,
        sectionKey: sectionByField.get(fieldKey) ?? null,
        sensitive: fieldNode[OM_FIELD_KEYWORDS.sensitive] === true,
        editableBy,
        visibleTo,
        required: requiredFields.has(fieldKey),
        validations,
        ...(validationMessages ? { validationMessages } : {}),
      }
    }

    const ajv = compileAjv(schema)
    const zodMirror = buildZodMirror(schema, fieldIndex)
    const schemaHash = computeSchemaHash(schema, uiSchema)
    const rolePolicyLookup = buildRolePolicyLookup(fieldIndex)
    const registryVersion = this.registry.getRegistryVersion()

    return {
      schemaHash,
      ajv,
      zod: zodMirror,
      fieldIndex,
      rolePolicyLookup,
      registryVersion,
    }
  }

  private evictIfFull(): void {
    while (this.cache.size >= this.cacheMax) {
      const oldest = this.cache.keys().next().value
      if (!oldest) break
      this.cache.delete(oldest)
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function assertObject(
  value: unknown,
  path: string[],
  code: FormCompilationErrorCode,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FormCompilationError(code, `Expected an object at "${path.join('.')}".`, path)
  }
  return value as Record<string, unknown>
}

function readDeclaredRoles(schema: Record<string, unknown>): string[] {
  const value = schema[OM_ROOT_KEYWORDS.roles]
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new FormCompilationError(
      'INVALID_EXTENSION',
      `Root keyword "${OM_ROOT_KEYWORDS.roles}" must be an array of role identifiers.`,
      [OM_ROOT_KEYWORDS.roles],
    )
  }
  return value as string[]
}

function validateRootExtensions(schema: Record<string, unknown>, declaredRoles: string[]): void {
  const violations: OmExtensionViolation[] = []
  for (const keyword of Object.values(OM_ROOT_KEYWORDS)) {
    if (!(keyword in schema)) continue
    const validate = OM_ROOT_VALIDATORS[keyword]
    const message = validate(schema[keyword])
    if (message) violations.push({ keyword, path: [keyword], message })
  }
  if (violations.length > 0) {
    const first = violations[0]
    throw new FormCompilationError('INVALID_EXTENSION', first.message, first.path)
  }

  const defaultActor = schema[OM_ROOT_KEYWORDS.defaultActorRole]
  if (typeof defaultActor === 'string' && !declaredRoles.includes(defaultActor)) {
    throw new FormCompilationError(
      'ROLE_NOT_DECLARED',
      `Root "${OM_ROOT_KEYWORDS.defaultActorRole}" references "${defaultActor}", which is not in "${OM_ROOT_KEYWORDS.roles}".`,
      [OM_ROOT_KEYWORDS.defaultActorRole],
    )
  }
}

function validateFieldExtensions(fieldNode: Record<string, unknown>, path: string[]): void {
  for (const keyword of Object.values(OM_FIELD_KEYWORDS)) {
    if (!(keyword in fieldNode)) continue
    const validate = OM_FIELD_VALIDATORS[keyword]
    const message = validate(fieldNode[keyword])
    if (message) {
      throw new FormCompilationError('INVALID_EXTENSION', message, [...path, keyword])
    }
  }
}

function readProperties(schema: Record<string, unknown>): Array<[string, unknown]> {
  const properties = schema.properties
  if (!properties) return []
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    throw new FormCompilationError(
      'INVALID_SCHEMA_SHAPE',
      'schema.properties must be an object map.',
      ['properties'],
    )
  }
  return Object.entries(properties as Record<string, unknown>)
}

function readRequired(schema: Record<string, unknown>): Set<string> {
  const required = schema.required
  if (required === undefined) return new Set()
  if (!Array.isArray(required) || !required.every((entry) => typeof entry === 'string')) {
    throw new FormCompilationError(
      'INVALID_SCHEMA_SHAPE',
      'schema.required must be an array of strings.',
      ['required'],
    )
  }
  return new Set(required as string[])
}

type ResolvedSection = { key: string; fieldKeys: string[] }

function readSections(schema: Record<string, unknown>): ResolvedSection[] {
  const value = schema[OM_ROOT_KEYWORDS.sections]
  if (value === undefined) return []
  if (!Array.isArray(value)) return []
  const result: ResolvedSection[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.key !== 'string') continue
    const fieldKeys = Array.isArray(candidate.fieldKeys)
      ? (candidate.fieldKeys as unknown[]).filter((key): key is string => typeof key === 'string')
      : []
    result.push({ key: candidate.key, fieldKeys })
  }
  return result
}

function buildSectionLookup(sections: ResolvedSection[]): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const section of sections) {
    for (const fieldKey of section.fieldKeys) {
      if (!lookup.has(fieldKey)) lookup.set(fieldKey, section.key)
    }
  }
  return lookup
}

// ============================================================================
// Read-time defaulters & page partitioning (Phase C — Decisions 2a/2b/9)
// ============================================================================

/**
 * Returns a defaulted view of a single section without mutating the input.
 *
 * Defaults applied (Decision 9):
 * - `kind`: `'section'`
 * - `columns`: `1`
 * - `gap`: `'md'`
 * - `divider`: `false`
 * - `hideTitle`: `false`
 *
 * The compiler never writes these defaults back to the persisted schema —
 * a verbatim round-trip preserves byte-identity (R-9 mitigation).
 */
export function resolveSectionView(section: unknown): ResolvedSectionView | null {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null
  const candidate = section as Record<string, unknown>
  if (typeof candidate.key !== 'string') return null
  const titleSource = candidate.title
  const title: Record<string, string> = {}
  if (titleSource && typeof titleSource === 'object' && !Array.isArray(titleSource)) {
    for (const [locale, raw] of Object.entries(titleSource as Record<string, unknown>)) {
      if (typeof raw === 'string') title[locale] = raw
    }
  }
  const fieldKeys = Array.isArray(candidate.fieldKeys)
    ? (candidate.fieldKeys as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : []
  const kind: 'page' | 'section' | 'ending' =
    candidate.kind === 'page' ? 'page' : candidate.kind === 'ending' ? 'ending' : 'section'
  const columnsRaw = candidate.columns
  const columns: 1 | 2 | 3 | 4 =
    columnsRaw === 2 || columnsRaw === 3 || columnsRaw === 4 ? columnsRaw : 1
  const gapRaw = candidate.gap
  const gap: 'sm' | 'md' | 'lg' =
    gapRaw === 'sm' || gapRaw === 'lg' ? gapRaw : 'md'
  const divider = candidate.divider === true
  const hideTitle = candidate.hideTitle === true
  return { key: candidate.key, title, fieldKeys, kind, columns, gap, divider, hideTitle }
}

/**
 * Resolves all sections from a schema with read-time defaults applied.
 * Skips malformed entries (matching `readSections` lenience).
 */
export function resolveSectionViews(schema: Record<string, unknown>): ResolvedSectionView[] {
  const value = schema[OM_ROOT_KEYWORDS.sections]
  if (!Array.isArray(value)) return []
  const result: ResolvedSectionView[] = []
  for (const entry of value) {
    const view = resolveSectionView(entry)
    if (view) result.push(view)
  }
  return result
}

/**
 * Implicit Page 1 partition (Decisions 2a / 2b).
 *
 * Algorithm:
 * - When no section declares `kind: 'page'`, return one page containing
 *   every section in declaration order.
 * - Otherwise, every `kind: 'page'` section starts a new page; sections
 *   preceding the first page-marker form an implicit Page 1.
 *
 * Page count formula: `pages = page-markers; if any sections precede the
 * first marker (or no markers exist), pages += 1`.
 *
 * The function accepts both raw `OmSection`-shaped entries and resolved
 * views — anything with `{ key, kind? }` works.
 */
export function partitionPages(
  sections: ReadonlyArray<{ key: string; kind?: 'page' | 'section' | 'ending' }>,
): ResolvedPage[] {
  if (sections.length === 0) return []
  const pages: ResolvedPage[] = []
  let current: ResolvedPage = { sectionKeys: [] }
  let hasContentBeforeFirstMarker = false
  let seenMarker = false
  for (const section of sections) {
    if (section.kind === 'page') {
      if (!seenMarker) {
        if (current.sectionKeys.length > 0) {
          // Sections precede the first page-marker — they form an implicit
          // Page 1. Emit the implicit page before starting the marker page.
          pages.push(current)
          hasContentBeforeFirstMarker = true
        }
        seenMarker = true
        current = { sectionKeys: [section.key] }
      } else {
        // Subsequent page-markers always emit a new page.
        pages.push(current)
        current = { sectionKeys: [section.key] }
      }
    } else {
      current.sectionKeys.push(section.key)
    }
  }
  pages.push(current)
  // When no markers were ever seen, the lone `current` is Page 1; nothing else to do.
  void hasContentBeforeFirstMarker
  return pages
}

/**
 * Returns the configured page mode for a schema, defaulting to `'stacked'`
 * (Decision 2c). Never writes the default back.
 */
export function resolvePageMode(schema: Record<string, unknown>): 'stacked' | 'paginated' {
  const value = schema[OM_ROOT_KEYWORDS.pageMode]
  return value === 'paginated' ? 'paginated' : 'stacked'
}

/**
 * Returns the configured supported locales for a schema, defaulting to
 * `['en']` (Decision 29b). Never writes the default back.
 */
export function resolveSupportedLocales(schema: Record<string, unknown>): string[] {
  const value = schema[OM_ROOT_KEYWORDS.supportedLocales]
  if (!Array.isArray(value)) return ['en']
  const filtered = value.filter((entry): entry is string => typeof entry === 'string')
  return filtered.length > 0 ? filtered : ['en']
}

/**
 * Returns the configured form style (theme density), defaulting to
 * `'default'` (Decision 20a). Never writes the default back.
 */
export function resolveFormStyle(
  schema: Record<string, unknown>,
): 'default' | 'compact' | 'spacious' {
  const value = schema[OM_ROOT_KEYWORDS.formStyle]
  return value === 'compact' || value === 'spacious' ? value : 'default'
}

/**
 * Returns the configured form-level label position, defaulting to `'top'`
 * (Decision 20b). Never writes the default back. Mobile viewport collapses
 * `'left'` → `'top'` at render time.
 */
export function resolveFormLabelPosition(
  schema: Record<string, unknown>,
): 'top' | 'left' {
  const value = schema[OM_ROOT_KEYWORDS.formLabelPosition]
  return value === 'left' ? 'left' : 'top'
}

/**
 * Returns whether the form should show a progress indicator. Defaults to
 * `false` (Decision 20c). Effective only when `pageMode === 'paginated'`
 * AND derived `pages.length >= 2` — gating is a renderer concern.
 */
export function resolveShowProgress(schema: Record<string, unknown>): boolean {
  return schema[OM_ROOT_KEYWORDS.showProgress] === true
}

function readValidationMessages(
  fieldNode: Record<string, unknown>,
): OmValidationMessages | undefined {
  const raw = fieldNode[OM_FIELD_KEYWORDS.validationMessages]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: OmValidationMessages = {}
  for (const [locale, inner] of Object.entries(raw as Record<string, unknown>)) {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue
    const innerOut: Record<string, string> = {}
    for (const [rule, message] of Object.entries(inner as Record<string, unknown>)) {
      if (typeof message === 'string' && message.length > 0) {
        innerOut[rule] = message
      }
    }
    if (Object.keys(innerOut).length > 0) result[locale] = innerOut
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function readStringArray(
  fieldNode: Record<string, unknown>,
  keyword: string,
  fallback: string[],
): string[] {
  const value = fieldNode[keyword]
  if (value === undefined) return fallback
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return fallback
  }
  return unique(value as string[])
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function compileAjv(schema: Record<string, unknown>): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, useDefaults: false, strict: false })
  addFormats(ajv)
  addOmKeywords(ajv)
  try {
    return ajv.compile(stripOmKeywordsForAjv(schema))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AJV error'
    throw new FormCompilationError('AJV_COMPILE_FAILED', `AJV failed to compile schema: ${message}`, [])
  }
}

/**
 * AJV doesn't enforce JSON-Schema-7 `additionalProperties: false` for OM
 * keywords because we register them as no-op annotations. To keep the schema
 * a clean JSON Schema 7 document, we strip the OM keywords for AJV
 * compilation — the OM extension semantics are checked separately by the
 * compiler.
 */
function stripOmKeywordsForAjv(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(schema, (key, value) => {
      if (typeof key === 'string' && key.startsWith('x-om-')) return undefined
      return value
    }),
  ) as Record<string, unknown>
}

function buildZodMirror(
  schema: Record<string, unknown>,
  fieldIndex: Record<string, FieldDescriptor>,
): z.ZodTypeAny {
  const properties = schema.properties as Record<string, unknown> | undefined
  if (!properties) return z.object({}).passthrough()
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [fieldKey, rawNode] of Object.entries(properties)) {
    const fieldNode = rawNode as Record<string, unknown>
    let scalar = mapJsonSchemaToZod(fieldNode)
    if (!fieldIndex[fieldKey]?.required) {
      scalar = scalar.optional()
    }
    shape[fieldKey] = scalar
  }
  return z.object(shape).strict()
}

function mapJsonSchemaToZod(node: Record<string, unknown>): z.ZodTypeAny {
  const type = node.type
  if (Array.isArray(type)) {
    if (type.length === 0) return z.unknown()
    return z.union(type.map((entry) => mapJsonSchemaToZod({ ...node, type: entry })) as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }
  switch (type) {
    case 'string': {
      let schema: z.ZodString | z.ZodTypeAny = z.string()
      if (typeof node.minLength === 'number') schema = (schema as z.ZodString).min(node.minLength)
      if (typeof node.maxLength === 'number') schema = (schema as z.ZodString).max(node.maxLength)
      if (Array.isArray(node.enum) && node.enum.every((entry) => typeof entry === 'string')) {
        return z.enum(node.enum as [string, ...string[]])
      }
      return schema
    }
    case 'integer':
      return z.number().int()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array': {
      const items = node.items
      if (items && typeof items === 'object' && !Array.isArray(items)) {
        return z.array(mapJsonSchemaToZod(items as Record<string, unknown>))
      }
      return z.array(z.unknown())
    }
    case 'object':
      return z.object({}).passthrough()
    case 'null':
      return z.null()
    default:
      return z.unknown()
  }
}

function computeSchemaHash(
  schema: Record<string, unknown>,
  uiSchema: Record<string, unknown>,
): string {
  const canonical = canonicalize({ schema, uiSchema })
  return createHash('sha256').update(canonical).digest('hex')
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
}

function buildRolePolicyLookup(fieldIndex: Record<string, FieldDescriptor>): RolePolicyLookup {
  return (role, fieldKey) => {
    const descriptor = fieldIndex[fieldKey]
    if (!descriptor) return { canRead: false, canWrite: false }
    const canWrite = descriptor.editableBy.includes(role)
    const canRead = canWrite || descriptor.visibleTo.includes(role)
    return { canRead, canWrite }
  }
}
