/**
 * Visual Builder schema-helpers — pure, deterministic mutations on the
 * studio's `FormSchema` view of an `x-om-*` form definition.
 *
 * Phase B (`.ai/specs/2026-05-10-forms-visual-builder.md`) wires drag-and-drop
 * onto `FormStudio.tsx`. Every drag-end mutation goes through these helpers
 * so the canvas, undo (Phase F), and tests share one source of truth.
 *
 * Constraints:
 * - Helpers MUST return a deeply cloned schema — callers compose updates on
 *   the returned value without aliasing into React state.
 * - Helpers MUST validate the OM extension payload via the existing
 *   `OM_FIELD_VALIDATORS` / `OM_ROOT_VALIDATORS` before returning. Validation
 *   failures throw `SchemaHelperError` with a human-readable message; the
 *   autosave guard surfaces the i18n key `forms.studio.autosave.invalidSchema`.
 * - Object key insertion order is canonical: helpers rebuild `properties`
 *   from `fieldKeys` so `Object.entries(properties)` matches the visible
 *   canvas order (Decision 8a + § "Object.entries ordering invariant").
 */

import {
  OM_FIELD_KEYWORDS,
  OM_FIELD_VALIDATORS,
  OM_ROOT_KEYWORDS,
  OM_ROOT_VALIDATORS,
  validateOmCrossKeyword,
  type OmFieldKeyword,
  type OmRootKeyword,
} from '../../../../schema/jsonschema-extensions'

export type FieldNode = {
  type: string | string[]
  'x-om-type': string
  'x-om-label'?: { [locale: string]: string }
  'x-om-help'?: { [locale: string]: string }
  'x-om-editable-by'?: string[]
  'x-om-visible-to'?: string[]
  'x-om-sensitive'?: boolean
  [key: string]: unknown
}

export type SectionNode = {
  key: string
  title: { [locale: string]: string }
  fieldKeys: string[]
  kind?: 'page' | 'section' | 'ending'
  columns?: 1 | 2 | 3 | 4
  gap?: 'sm' | 'md' | 'lg'
  divider?: boolean
  hideTitle?: boolean
  'x-om-visibility-if'?: unknown
  'x-om-redirect-url'?: string | null
  [key: string]: unknown
}

/** Sentinel section key used by the lenient orphan render (Decision 4c). */
export const UNGROUPED_SECTION_KEY = '__ungrouped__'

export type FormSchema = {
  type: 'object'
  'x-om-roles'?: string[]
  'x-om-default-actor-role'?: string
  'x-om-sections'?: SectionNode[]
  properties: Record<string, FieldNode>
  required?: string[]
}

export class SchemaHelperError extends Error {
  readonly code: string
  readonly path: string[]
  constructor(message: string, code: string, path: string[] = []) {
    super(message)
    this.name = 'SchemaHelperError'
    this.code = code
    this.path = path
  }
}

const FIELD_TYPE_TO_JSON_TYPE: Record<string, string> = {
  text: 'string',
  textarea: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  yes_no: 'boolean',
  date: 'string',
  datetime: 'string',
  select_one: 'string',
  select_many: 'array',
  scale: 'integer',
  info_block: 'string',
}

const FIELD_KEY_PATTERN = /^field_(\d+)$/

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Generates the next `field_<n>` key per Decision 21a — `1 + max numeric
 * suffix in properties`. Non-numeric keys (custom-edited or legacy) are
 * ignored so they never collide with the auto-generated stream.
 */
export function nextFieldKey(properties: Record<string, unknown>): string {
  let maxSuffix = 0
  for (const key of Object.keys(properties)) {
    const match = FIELD_KEY_PATTERN.exec(key)
    if (!match) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value) && value > maxSuffix) maxSuffix = value
  }
  return `field_${maxSuffix + 1}`
}

/**
 * Generates the next `section_<n>` key per Decision 21c. Section keys are
 * globally unique within `x-om-sections`.
 */
export function nextSectionKey(sections: ReadonlyArray<SectionNode> | undefined): string {
  let maxSuffix = 0
  const pattern = /^section_(\d+)$/
  for (const section of sections ?? []) {
    const match = pattern.exec(section.key)
    if (!match) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value) && value > maxSuffix) maxSuffix = value
  }
  return `section_${maxSuffix + 1}`
}

/**
 * Validates the OM extension payload of a schema. Throws on the first
 * violation so callers can guard autosaves before PATCHing.
 */
export function validateSchemaExtensions(schema: FormSchema): void {
  for (const [keyword, validator] of Object.entries(OM_ROOT_VALIDATORS)) {
    const rootKeyword = keyword as OmRootKeyword
    const value = (schema as Record<string, unknown>)[rootKeyword]
    if (value === undefined) continue
    const violation = validator(value)
    if (violation) throw new SchemaHelperError(violation, 'invalid_root', [rootKeyword])
  }
  for (const [fieldKey, fieldNode] of Object.entries(schema.properties)) {
    if (!fieldNode || typeof fieldNode !== 'object') {
      throw new SchemaHelperError('Field nodes must be objects.', 'invalid_field', [fieldKey])
    }
    for (const [keyword, validator] of Object.entries(OM_FIELD_VALIDATORS)) {
      const fieldKeyword = keyword as OmFieldKeyword
      const value = (fieldNode as Record<string, unknown>)[fieldKeyword]
      if (value === undefined) continue
      const violation = validator(value)
      if (violation) {
        throw new SchemaHelperError(violation, 'invalid_field', [fieldKey, fieldKeyword])
      }
    }
  }
  const crossKeywordViolation = validateOmCrossKeyword(schema as Record<string, unknown>)
  if (crossKeywordViolation) {
    throw new SchemaHelperError(crossKeywordViolation, 'invalid_cross_keyword', [])
  }
}

/**
 * Builds a schema with `properties` rebuilt from a canonical key array so
 * `Object.entries(properties)` matches the array order. Existing field
 * nodes are preserved; missing keys silently drop (caller should never
 * pass unknown keys, but the helper is defensive).
 */
function rebuildPropertiesByOrder(
  schema: FormSchema,
  orderedKeys: ReadonlyArray<string>,
): FormSchema {
  const next = deepClone(schema)
  const sourceProperties = next.properties
  const seen = new Set<string>()
  const rebuilt: Record<string, FieldNode> = {}
  for (const key of orderedKeys) {
    if (seen.has(key)) continue
    seen.add(key)
    const node = sourceProperties[key]
    if (!node) continue
    rebuilt[key] = node
  }
  for (const [key, node] of Object.entries(sourceProperties)) {
    if (seen.has(key)) continue
    rebuilt[key] = node
  }
  next.properties = rebuilt
  return next
}

/**
 * Returns the section that owns the given field key, or `null` if the
 * field is orphaned (not listed in any section's `fieldKeys`).
 */
export function findSectionOwning(
  schema: FormSchema,
  fieldKey: string,
): SectionNode | null {
  const sections = schema[OM_ROOT_KEYWORDS.sections] ?? []
  for (const section of sections) {
    if (section.fieldKeys.includes(fieldKey)) return section
  }
  return null
}

/**
 * Returns the index of `fieldKey` within `sectionKey.fieldKeys`, or `-1`
 * if either the section or the field within it is absent.
 */
export function indexOfFieldInSection(
  schema: FormSchema,
  sectionKey: string,
  fieldKey: string,
): number {
  const sections = schema[OM_ROOT_KEYWORDS.sections] ?? []
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) return -1
  return section.fieldKeys.indexOf(fieldKey)
}

export type LinearFieldEntry = {
  key: string
  sectionKey: string | null
}

/**
 * Linearizes the schema into a flat ordered list of fields — sections
 * first (in declaration order), orphan fields appended last. Used by the
 * canvas to memoize the visible field sequence per Decision 34.
 */
export function linearizeFields(schema: FormSchema): LinearFieldEntry[] {
  const linear: LinearFieldEntry[] = []
  const sections = schema[OM_ROOT_KEYWORDS.sections] ?? []
  const claimed = new Set<string>()
  for (const section of sections) {
    for (const fieldKey of section.fieldKeys) {
      if (claimed.has(fieldKey)) continue
      claimed.add(fieldKey)
      linear.push({ key: fieldKey, sectionKey: section.key })
    }
  }
  for (const fieldKey of Object.keys(schema.properties)) {
    if (claimed.has(fieldKey)) continue
    linear.push({ key: fieldKey, sectionKey: null })
  }
  return linear
}

export type AddFieldTarget = {
  sectionKey: string
  /** Insertion index within `sectionKey.fieldKeys`. Appends when omitted. */
  index?: number
}

export type AddFieldResult = {
  schema: FormSchema
  fieldKey: string
}

/**
 * Appends or inserts a new field of `typeKey` into the section identified by
 * `target.sectionKey`. Generates a unique key via `nextFieldKey` and
 * rebuilds `properties` so `Object.entries` matches the section ordering.
 */
export function addFieldFromPalette(input: {
  schema: FormSchema
  typeKey: string
  target: AddFieldTarget
}): AddFieldResult {
  const { schema, typeKey, target } = input
  if (!typeKey) {
    throw new SchemaHelperError('typeKey is required.', 'invalid_input', ['typeKey'])
  }
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === target.sectionKey)
  if (!section) {
    throw new SchemaHelperError(
      `Section "${target.sectionKey}" not found.`,
      'unknown_section',
      [target.sectionKey],
    )
  }
  const newKey = nextFieldKey(next.properties)
  const jsonType = FIELD_TYPE_TO_JSON_TYPE[typeKey] ?? 'string'
  const fieldNode: FieldNode = {
    type: jsonType,
    'x-om-type': typeKey,
    'x-om-label': { en: 'New field' },
    'x-om-editable-by': ['admin'],
  }
  next.properties[newKey] = fieldNode
  next.required = next.required ?? []

  const insertionIndex =
    typeof target.index === 'number' && target.index >= 0 && target.index <= section.fieldKeys.length
      ? target.index
      : section.fieldKeys.length
  section.fieldKeys = [
    ...section.fieldKeys.slice(0, insertionIndex),
    newKey,
    ...section.fieldKeys.slice(insertionIndex),
  ]

  const orderedKeys = collectCanonicalOrder(next)
  const result = rebuildPropertiesByOrder(next, orderedKeys)
  validateSchemaExtensions(result)
  return { schema: result, fieldKey: newKey }
}

export type MoveFieldTarget = {
  sectionKey: string
  /** Insertion index within `sectionKey.fieldKeys`. Appends when omitted. */
  index?: number
}

/**
 * Moves an existing field to a new location, optionally re-parenting it
 * to a different section. Preserves all node metadata verbatim
 * (Decision 8b — `gridSpan` etc. survive cross-section moves).
 */
export function moveField(input: {
  schema: FormSchema
  fieldKey: string
  target: MoveFieldTarget
}): FormSchema {
  const { schema, fieldKey, target } = input
  if (!schema.properties[fieldKey]) {
    throw new SchemaHelperError(
      `Field "${fieldKey}" not found.`,
      'unknown_field',
      [fieldKey],
    )
  }
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const targetSection = sections.find((entry) => entry.key === target.sectionKey)
  if (!targetSection) {
    throw new SchemaHelperError(
      `Section "${target.sectionKey}" not found.`,
      'unknown_section',
      [target.sectionKey],
    )
  }
  for (const section of sections) {
    section.fieldKeys = section.fieldKeys.filter((entry) => entry !== fieldKey)
  }
  const insertionIndex =
    typeof target.index === 'number' && target.index >= 0 && target.index <= targetSection.fieldKeys.length
      ? target.index
      : targetSection.fieldKeys.length
  targetSection.fieldKeys = [
    ...targetSection.fieldKeys.slice(0, insertionIndex),
    fieldKey,
    ...targetSection.fieldKeys.slice(insertionIndex),
  ]
  const orderedKeys = collectCanonicalOrder(next)
  const result = rebuildPropertiesByOrder(next, orderedKeys)
  validateSchemaExtensions(result)
  return result
}

export type AddLayoutTarget = {
  /**
   * Insertion index within `x-om-sections`. Appends when omitted or out of
   * range. Used by section-reorder DnD to drop a new layout primitive at a
   * specific position.
   */
  index?: number
}

export type AddLayoutResult = {
  schema: FormSchema
  sectionKey: string
}

/**
 * Materialises a new layout container (`page` or `section`) in
 * `x-om-sections`. Phase C — Decision 1 / Decision 9.
 *
 * Persisted shape is intentionally minimal: `{ key, kind, title, fieldKeys }`.
 * `columns / gap / divider / hideTitle` defaults are applied at read time
 * by the compiler so a verbatim round-trip keeps the schema byte-identical
 * (R-9 mitigation).
 */
export function addLayoutFromPalette(input: {
  schema: FormSchema
  kind: 'page' | 'section'
  target?: AddLayoutTarget
}): AddLayoutResult {
  const { schema, kind } = input
  if (kind !== 'page' && kind !== 'section') {
    throw new SchemaHelperError(
      `Unknown layout kind "${String(kind)}" — expected "page" or "section".`,
      'invalid_layout_kind',
      ['kind'],
    )
  }
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const newKey = nextSectionKey(sections)
  const newSection: SectionNode = {
    key: newKey,
    kind,
    title: { en: kind === 'page' ? 'New page' : 'New section' },
    fieldKeys: [],
  }
  const desiredIndex = input.target?.index
  const insertionIndex =
    typeof desiredIndex === 'number' && desiredIndex >= 0 && desiredIndex <= sections.length
      ? desiredIndex
      : sections.length
  const inserted: SectionNode[] = [
    ...sections.slice(0, insertionIndex),
    newSection,
    ...sections.slice(insertionIndex),
  ]
  next[OM_ROOT_KEYWORDS.sections] = inserted
  validateSchemaExtensions(next)
  return { schema: next, sectionKey: newKey }
}

/**
 * Reorders the section list. `beforeKey` is the section currently at the
 * desired insertion slot — passing `null` appends. Decision 8c (pure
 * positional reorder; cross-page-boundary drags do not require confirms).
 */
export function moveSection(input: {
  schema: FormSchema
  sectionKey: string
  beforeKey: string | null
}): FormSchema {
  const { schema, sectionKey, beforeKey } = input
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const sourceIndex = sections.findIndex((entry) => entry.key === sectionKey)
  if (sourceIndex < 0) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  const [moved] = sections.splice(sourceIndex, 1)
  let targetIndex = sections.length
  if (beforeKey !== null) {
    const candidate = sections.findIndex((entry) => entry.key === beforeKey)
    if (candidate >= 0) targetIndex = candidate
  }
  sections.splice(targetIndex, 0, moved)
  next[OM_ROOT_KEYWORDS.sections] = sections
  validateSchemaExtensions(next)
  return next
}

/**
 * Removes a section. Fields owned by the section are also removed from
 * `properties` and `required` — Decision 22b's confirm dialog is a UI
 * concern; this helper is the structural mutator.
 */
export function deleteSection(input: {
  schema: FormSchema
  sectionKey: string
}): FormSchema {
  const { schema, sectionKey } = input
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const target = sections.find((entry) => entry.key === sectionKey)
  if (!target) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  const fieldsToRemove = new Set(target.fieldKeys)
  next[OM_ROOT_KEYWORDS.sections] = sections.filter((entry) => entry.key !== sectionKey)
  for (const fieldKey of fieldsToRemove) {
    delete next.properties[fieldKey]
  }
  next.required = (next.required ?? []).filter((entry) => !fieldsToRemove.has(entry))
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets a section's `columns`. Persists the value verbatim — Decision 3a
 * keeps `gridSpan` clamping to render time, so changing columns never
 * rewrites field-level spans.
 */
export function setSectionColumns(input: {
  schema: FormSchema
  sectionKey: string
  columns: 1 | 2 | 3 | 4
}): FormSchema {
  const { schema, sectionKey, columns } = input
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  if (columns === 1) {
    delete section.columns
  } else {
    section.columns = columns
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Updates a section's localized title for the given locale (Decision 26a/26b).
 * Empty strings clear the locale entry to keep the persisted shape tidy.
 */
export function setSectionTitle(input: {
  schema: FormSchema
  sectionKey: string
  locale: string
  title: string
}): FormSchema {
  const { schema, sectionKey, locale, title } = input
  if (!locale) {
    throw new SchemaHelperError('locale is required.', 'invalid_input', ['locale'])
  }
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  const titleMap = section.title ? { ...section.title } : {}
  if (title.length === 0) {
    delete titleMap[locale]
  } else {
    titleMap[locale] = title
  }
  section.title = titleMap
  validateSchemaExtensions(next)
  return next
}

/**
 * Updates a section's `kind` (`page` ⇄ `section`). Decision 10c — the
 * toggle is reversible so we never write a confirm dialog around it.
 */
export function setSectionKind(input: {
  schema: FormSchema
  sectionKey: string
  kind: 'page' | 'section'
}): FormSchema {
  const { schema, sectionKey, kind } = input
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  if (kind === 'section') {
    delete section.kind
  } else {
    section.kind = kind
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets the section `gap` (`'sm' | 'md' | 'lg'`). `'md'` is the default and
 * unsets the persisted value to keep the shape minimal (Decision 9).
 */
export function setSectionGap(input: {
  schema: FormSchema
  sectionKey: string
  gap: 'sm' | 'md' | 'lg'
}): FormSchema {
  const { schema, sectionKey, gap } = input
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  if (gap === 'md') {
    delete section.gap
  } else {
    section.gap = gap
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Toggles a section's `divider` boolean. `false` is the default and is
 * persisted as the absence of the key (Decision 9).
 */
export function setSectionDivider(input: {
  schema: FormSchema
  sectionKey: string
  divider: boolean
}): FormSchema {
  const { schema, sectionKey, divider } = input
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  if (divider === false) {
    delete section.divider
  } else {
    section.divider = true
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Toggles a section's `hideTitle` boolean. `false` is the default and is
 * persisted as the absence of the key (Decision 9).
 */
export function setSectionHideTitle(input: {
  schema: FormSchema
  sectionKey: string
  hideTitle: boolean
}): FormSchema {
  const { schema, sectionKey, hideTitle } = input
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  if (hideTitle === false) {
    delete section.hideTitle
  } else {
    section.hideTitle = true
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets a field's persisted `x-om-grid-span`. Persisted verbatim per
 * Decision 3a — clamping against the parent section's `columns` is the
 * renderer's job, never the validator's.
 */
export function setFieldGridSpan(input: {
  schema: FormSchema
  fieldKey: string
  span: 1 | 2 | 3 | 4
}): FormSchema {
  const { schema, fieldKey, span } = input
  const next = deepClone(schema)
  const node = next.properties[fieldKey]
  if (!node) {
    throw new SchemaHelperError(
      `Field "${fieldKey}" not found.`,
      'unknown_field',
      [fieldKey],
    )
  }
  if (span === 1) {
    delete node['x-om-grid-span']
  } else {
    node['x-om-grid-span'] = span
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets a field's `x-om-align`. Default `'start'` is persisted as the
 * absence of the key to keep the persisted shape minimal (read-time
 * defaulters apply at render time).
 */
export function setFieldAlign(input: {
  schema: FormSchema
  fieldKey: string
  align: 'start' | 'center' | 'end'
}): FormSchema {
  const { schema, fieldKey, align } = input
  const next = deepClone(schema)
  const node = next.properties[fieldKey]
  if (!node) {
    throw new SchemaHelperError(
      `Field "${fieldKey}" not found.`,
      'unknown_field',
      [fieldKey],
    )
  }
  if (align === 'start') {
    delete node[OM_FIELD_KEYWORDS.align]
  } else {
    node[OM_FIELD_KEYWORDS.align] = align
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets (or clears) a field's `x-om-visibility-if` jsonlogic predicate
 * (reactive-core spec — Phase B). `null` / `undefined` clears the keyword
 * to keep the persisted shape minimal so a no-op round-trip preserves the
 * schema hash (R-9 mitigation).
 */
export function setFieldVisibilityIf(input: {
  schema: FormSchema
  fieldKey: string
  predicate: unknown | null
}): FormSchema {
  const { schema, fieldKey, predicate } = input
  const next = deepClone(schema)
  const node = next.properties[fieldKey]
  if (!node) {
    throw new SchemaHelperError(
      `Field "${fieldKey}" not found.`,
      'unknown_field',
      [fieldKey],
    )
  }
  if (predicate === null || predicate === undefined) {
    delete node[OM_FIELD_KEYWORDS.visibilityIf]
  } else {
    node[OM_FIELD_KEYWORDS.visibilityIf] = predicate
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets (or clears) a section's `x-om-visibility-if` jsonlogic predicate.
 * Endings reject visibility predicates (validated by `OM_ROOT_VALIDATORS`).
 */
export function setSectionVisibilityIf(input: {
  schema: FormSchema
  sectionKey: string
  predicate: unknown | null
}): FormSchema {
  const { schema, sectionKey, predicate } = input
  const next = deepClone(schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) {
    throw new SchemaHelperError(
      `Section "${sectionKey}" not found.`,
      'unknown_section',
      [sectionKey],
    )
  }
  if (predicate === null || predicate === undefined) {
    delete (section as Record<string, unknown>)['x-om-visibility-if']
  } else {
    ;(section as Record<string, unknown>)['x-om-visibility-if'] = predicate
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Toggles a field's `x-om-hide-mobile` flag. `false` is persisted as the
 * absence of the key (Decision 33 — visibly collapses only on the mobile
 * viewport; tablet preserved).
 */
export function setFieldHideMobile(input: {
  schema: FormSchema
  fieldKey: string
  value: boolean
}): FormSchema {
  const { schema, fieldKey, value } = input
  const next = deepClone(schema)
  const node = next.properties[fieldKey]
  if (!node) {
    throw new SchemaHelperError(
      `Field "${fieldKey}" not found.`,
      'unknown_field',
      [fieldKey],
    )
  }
  if (value === false) {
    delete node[OM_FIELD_KEYWORDS.hideMobile]
  } else {
    node[OM_FIELD_KEYWORDS.hideMobile] = true
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Field-type swap families (Decision 31a). Cross-family swaps are not
 * supported — the studio surfaces a "delete and recreate" link instead.
 *
 * The map is exposed so UI components can compute the available targets
 * without re-implementing the family rule.
 */
export const SWAP_FAMILIES: Record<string, ReadonlySet<string>> = {
  text: new Set(['text', 'textarea']),
  textarea: new Set(['text', 'textarea']),
  number: new Set(['number', 'integer']),
  integer: new Set(['number', 'integer']),
  select_one: new Set(['select_one', 'select_many']),
  select_many: new Set(['select_one', 'select_many']),
}

const FIELD_TYPE_TO_DEFAULT_UI: Record<string, Record<string, unknown>> = {
  text: { widget: 'text' },
  textarea: { widget: 'textarea', rows: 4 },
  number: { widget: 'number' },
  integer: { widget: 'integer' },
  boolean: { widget: 'checkbox' },
  yes_no: { widget: 'yes_no' },
  date: { widget: 'date' },
  datetime: { widget: 'datetime' },
  select_one: { widget: 'select' },
  select_many: { widget: 'multiselect' },
  scale: { widget: 'scale' },
  info_block: { widget: 'info' },
}

/**
 * Returns true when `from` and `to` belong to the same compatible family
 * defined in `SWAP_FAMILIES`. Identity swaps (`from === to`) return true.
 */
export function isCompatibleFieldSwap(from: string, to: string): boolean {
  if (from === to) return true
  const family = SWAP_FAMILIES[from]
  if (!family) return false
  return family.has(to)
}

/**
 * Swaps a field's `x-om-type` within a compatible family (Decision 31a).
 *
 * Behavior:
 * - Defensive: throws when the swap is cross-family — the UI is expected to
 *   gate the call by `isCompatibleFieldSwap`.
 * - Preserves: `key`, `x-om-label`, `x-om-help`, `x-om-editable-by`,
 *   `x-om-visible-to`, `x-om-sensitive`, `x-om-grid-span`, `x-om-align`,
 *   `x-om-hide-mobile`, and `required` membership.
 * - Drops incompatible scalars: cross-target props that don't apply
 *   (`x-om-options` when leaving the select family; `x-om-min` / `x-om-max`
 *   when leaving the number family) and the previous `x-om-widget` override.
 * - Applies the registry's `defaultUiSchema` widget for the target type.
 */
export function swapFieldType(input: {
  schema: FormSchema
  fieldKey: string
  targetType: string
}): FormSchema {
  const { schema, fieldKey, targetType } = input
  const node = schema.properties[fieldKey]
  if (!node) {
    throw new SchemaHelperError(
      `Field "${fieldKey}" not found.`,
      'unknown_field',
      [fieldKey],
    )
  }
  const fromType = String(node['x-om-type'] ?? '')
  if (!isCompatibleFieldSwap(fromType, targetType)) {
    throw new SchemaHelperError(
      `Cross-family swap "${fromType}" → "${targetType}" is not supported. Delete the field and recreate it.`,
      'incompatible_swap',
      [fieldKey, OM_FIELD_KEYWORDS.type],
    )
  }
  const next = deepClone(schema)
  const target = next.properties[fieldKey]
  target['x-om-type'] = targetType
  target.type = FIELD_TYPE_TO_JSON_TYPE[targetType] ?? target.type ?? 'string'
  const targetUi = FIELD_TYPE_TO_DEFAULT_UI[targetType]
  if (targetUi && typeof targetUi.widget === 'string') {
    target[OM_FIELD_KEYWORDS.widget] = targetUi.widget
  } else {
    delete target[OM_FIELD_KEYWORDS.widget]
  }
  // Drop options when leaving the select family.
  const leavingSelectFamily =
    (fromType === 'select_one' || fromType === 'select_many')
    && targetType !== 'select_one'
    && targetType !== 'select_many'
  if (leavingSelectFamily) {
    delete target[OM_FIELD_KEYWORDS.options]
  }
  // Drop min/max when leaving the number/integer family.
  const leavingNumberFamily =
    (fromType === 'number' || fromType === 'integer')
    && targetType !== 'number'
    && targetType !== 'integer'
  if (leavingNumberFamily) {
    delete target[OM_FIELD_KEYWORDS.min]
    delete target[OM_FIELD_KEYWORDS.max]
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets the form-level theme density (Decision 20a). Persisted only when
 * not at default; default (`'default'`) clears the key to keep the
 * persisted shape minimal (R-9 mitigation — verbatim round-trip).
 */
export function setFormStyle(input: {
  schema: FormSchema
  style: 'default' | 'compact' | 'spacious'
}): FormSchema {
  const { schema, style } = input
  const next = deepClone(schema)
  if (style === 'default') {
    delete (next as Record<string, unknown>)[OM_ROOT_KEYWORDS.formStyle]
  } else {
    ;(next as Record<string, unknown>)[OM_ROOT_KEYWORDS.formStyle] = style
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets the form-level label position (Decision 20b). Default `'top'`
 * clears the key. Mobile viewport collapses `'left'` → `'top'` at render
 * time (renderer concern).
 */
export function setFormLabelPosition(input: {
  schema: FormSchema
  position: 'top' | 'left'
}): FormSchema {
  const { schema, position } = input
  const next = deepClone(schema)
  if (position === 'top') {
    delete (next as Record<string, unknown>)[OM_ROOT_KEYWORDS.formLabelPosition]
  } else {
    ;(next as Record<string, unknown>)[OM_ROOT_KEYWORDS.formLabelPosition] = position
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Sets the form-level page-mode (Decision 2c). Default `'stacked'` clears
 * the key.
 */
export function setPageMode(input: {
  schema: FormSchema
  mode: 'stacked' | 'paginated'
}): FormSchema {
  const { schema, mode } = input
  const next = deepClone(schema)
  if (mode === 'stacked') {
    delete (next as Record<string, unknown>)[OM_ROOT_KEYWORDS.pageMode]
  } else {
    ;(next as Record<string, unknown>)[OM_ROOT_KEYWORDS.pageMode] = mode
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Toggles the form-level show-progress flag (Decision 20c). Default
 * `false` clears the key. Effective only when paginated AND pages >= 2;
 * gating is the renderer's job.
 */
export function setShowProgress(input: {
  schema: FormSchema
  value: boolean
}): FormSchema {
  const { schema, value } = input
  const next = deepClone(schema)
  if (value === false) {
    delete (next as Record<string, unknown>)[OM_ROOT_KEYWORDS.showProgress]
  } else {
    ;(next as Record<string, unknown>)[OM_ROOT_KEYWORDS.showProgress] = true
  }
  validateSchemaExtensions(next)
  return next
}

/**
 * Returns the field keys present in `properties` but not listed in any
 * `x-om-sections[*].fieldKeys`. Order matches `properties` insertion order
 * (Decision 4c).
 */
export function computeOrphanFieldKeys(schema: FormSchema): string[] {
  const sections = (schema[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const claimed = new Set<string>()
  for (const section of sections) {
    for (const fieldKey of section.fieldKeys) claimed.add(fieldKey)
  }
  const orphans: string[] = []
  for (const fieldKey of Object.keys(schema.properties)) {
    if (!claimed.has(fieldKey)) orphans.push(fieldKey)
  }
  return orphans
}

/**
 * Materialises the synthesized "Ungrouped" container into a real section
 * at the top of `x-om-sections` (Decision 12c). Field key order is
 * preserved from `properties` insertion order. The new section gets the
 * next available `section_<n>` key.
 */
export function adoptUngroupedAsSection(input: {
  schema: FormSchema
}): { schema: FormSchema; sectionKey: string } {
  const orphans = computeOrphanFieldKeys(input.schema)
  if (orphans.length === 0) {
    throw new SchemaHelperError(
      'No ungrouped fields to adopt.',
      'no_orphans',
      [],
    )
  }
  const next = deepClone(input.schema)
  const sections = (next[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  const newKey = nextSectionKey(sections)
  const newSection: SectionNode = {
    key: newKey,
    kind: 'section',
    title: { en: 'Untitled' },
    fieldKeys: [...orphans],
  }
  next[OM_ROOT_KEYWORDS.sections] = [newSection, ...sections]
  validateSchemaExtensions(next)
  return { schema: next, sectionKey: newKey }
}

function collectCanonicalOrder(schema: FormSchema): string[] {
  const ordered: string[] = []
  const sections = (schema[OM_ROOT_KEYWORDS.sections] ?? []) as SectionNode[]
  for (const section of sections) {
    for (const fieldKey of section.fieldKeys) {
      if (!ordered.includes(fieldKey)) ordered.push(fieldKey)
    }
  }
  for (const fieldKey of Object.keys(schema.properties)) {
    if (!ordered.includes(fieldKey)) ordered.push(fieldKey)
  }
  return ordered
}
