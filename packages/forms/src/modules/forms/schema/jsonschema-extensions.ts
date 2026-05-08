import type Ajv from 'ajv'

/**
 * Forms v1 JSON Schema extensions (`x-om-*`).
 *
 * The studio writes JSON Schema 7-shaped form definitions and decorates them
 * with these annotation keywords to capture form-specific semantics
 * (per-field role policy, localized labels, sections, sensitivity flag,
 * conditional visibility, etc.). This file centralises the keyword catalog
 * so the compiler, the studio, and the renderer all agree on the v1 surface.
 *
 * The catalog itself is FROZEN: removing or renaming any of these keywords
 * is a BC break (root AGENTS.md § Backward Compatibility Contract). Adding
 * a new `x-om-*` keyword is additive and safe.
 */

// ============================================================================
// Root-level extensions
// ============================================================================

export const OM_ROOT_KEYWORDS = {
  /** Array of role identifiers participating in this form. */
  roles: 'x-om-roles',
  /** Role auto-assigned to the actor who starts a submission. */
  defaultActorRole: 'x-om-default-actor-role',
  /** Ordered section list — drives the renderer's step flow. */
  sections: 'x-om-sections',
} as const

// ============================================================================
// Field-level extensions
// ============================================================================

export const OM_FIELD_KEYWORDS = {
  /** Field type key (must resolve in the FieldTypeRegistry). */
  type: 'x-om-type',
  /** Localized field label: `{ [locale]: string }`. */
  label: 'x-om-label',
  /** Localized help text: `{ [locale]: string }`. */
  help: 'x-om-help',
  /** Roles allowed to write this field (defaults to `['admin']`). */
  editableBy: 'x-om-editable-by',
  /** Roles allowed to read this field (defaults to editableBy ∪ ['admin']). */
  visibleTo: 'x-om-visible-to',
  /** Marks the field as sensitive — triggers redaction + per-field encryption hardening. */
  sensitive: 'x-om-sensitive',
  /** jsonlogic expression — evaluated by the renderer (phase 2c). */
  visibilityIf: 'x-om-visibility-if',
  /** Choice list for select_one / select_many: `[{ value, label: { [locale]: string } }]`. */
  options: 'x-om-options',
  /** Lower bound for scale / number fields. */
  min: 'x-om-min',
  /** Upper bound for scale / number fields. */
  max: 'x-om-max',
  /** uiSchema widget override. */
  widget: 'x-om-widget',
} as const

export type OmRootKeyword = (typeof OM_ROOT_KEYWORDS)[keyof typeof OM_ROOT_KEYWORDS]
export type OmFieldKeyword = (typeof OM_FIELD_KEYWORDS)[keyof typeof OM_FIELD_KEYWORDS]

/** Flat list of every keyword the v1 grammar declares. */
export const OM_ALL_KEYWORDS: readonly string[] = [
  ...Object.values(OM_ROOT_KEYWORDS),
  ...Object.values(OM_FIELD_KEYWORDS),
]

// ============================================================================
// TypeScript shapes
// ============================================================================

export type LocalizedText = Record<string, string>

export type OmSection = {
  key: string
  title: LocalizedText
  fieldKeys: string[]
}

export type OmRootExtensions = {
  [OM_ROOT_KEYWORDS.roles]?: string[]
  [OM_ROOT_KEYWORDS.defaultActorRole]?: string
  [OM_ROOT_KEYWORDS.sections]?: OmSection[]
}

export type OmFieldOption = {
  value: string
  label: LocalizedText
}

export type OmFieldExtensions = {
  [OM_FIELD_KEYWORDS.type]?: string
  [OM_FIELD_KEYWORDS.label]?: LocalizedText
  [OM_FIELD_KEYWORDS.help]?: LocalizedText
  [OM_FIELD_KEYWORDS.editableBy]?: string[]
  [OM_FIELD_KEYWORDS.visibleTo]?: string[]
  [OM_FIELD_KEYWORDS.sensitive]?: boolean
  [OM_FIELD_KEYWORDS.visibilityIf]?: unknown
  [OM_FIELD_KEYWORDS.options]?: OmFieldOption[]
  [OM_FIELD_KEYWORDS.min]?: number
  [OM_FIELD_KEYWORDS.max]?: number
  [OM_FIELD_KEYWORDS.widget]?: string
}

// ============================================================================
// Static meta-schema fragments — used by the compiler to validate the OM
// extension payload independently of the underlying JSON Schema rules.
// ============================================================================

/**
 * Per-keyword type predicates. Used by `validateOmExtensions(...)` below to
 * report `{ keyword, message }` errors without dragging in a full JSON Schema
 * runtime — the OM grammar is small enough that explicit validators are
 * clearer than a meta-schema.
 */
const localizedTextValid = (value: unknown): boolean =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')

const stringArrayValid = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

export type OmExtensionViolation = {
  keyword: string
  path: string[]
  message: string
}

export const OM_ROOT_VALIDATORS: Record<OmRootKeyword, (value: unknown) => string | null> = {
  [OM_ROOT_KEYWORDS.roles]: (value) =>
    stringArrayValid(value) ? null : 'x-om-roles must be an array of role identifiers (strings).',
  [OM_ROOT_KEYWORDS.defaultActorRole]: (value) =>
    typeof value === 'string' ? null : 'x-om-default-actor-role must be a role identifier string.',
  [OM_ROOT_KEYWORDS.sections]: (value) => {
    if (!Array.isArray(value)) return 'x-om-sections must be an array of section descriptors.'
    for (const section of value) {
      if (!section || typeof section !== 'object') return 'Each section must be an object.'
      const candidate = section as Record<string, unknown>
      if (typeof candidate.key !== 'string') return 'Each section must declare a string `key`.'
      if (!localizedTextValid(candidate.title)) return 'Each section must declare a localized `title` map.'
      if (!stringArrayValid(candidate.fieldKeys)) return 'Each section must declare a string array `fieldKeys`.'
    }
    return null
  },
}

export const OM_FIELD_VALIDATORS: Record<OmFieldKeyword, (value: unknown) => string | null> = {
  [OM_FIELD_KEYWORDS.type]: (value) =>
    typeof value === 'string' && value.length > 0 ? null : 'x-om-type must be a non-empty string.',
  [OM_FIELD_KEYWORDS.label]: (value) =>
    localizedTextValid(value) ? null : 'x-om-label must be a `{ [locale]: string }` map.',
  [OM_FIELD_KEYWORDS.help]: (value) =>
    localizedTextValid(value) ? null : 'x-om-help must be a `{ [locale]: string }` map.',
  [OM_FIELD_KEYWORDS.editableBy]: (value) =>
    stringArrayValid(value) ? null : 'x-om-editable-by must be an array of role identifiers (strings).',
  [OM_FIELD_KEYWORDS.visibleTo]: (value) =>
    stringArrayValid(value) ? null : 'x-om-visible-to must be an array of role identifiers (strings).',
  [OM_FIELD_KEYWORDS.sensitive]: (value) =>
    typeof value === 'boolean' ? null : 'x-om-sensitive must be a boolean.',
  [OM_FIELD_KEYWORDS.visibilityIf]: () => null, // jsonlogic — validated when phase 2c lands.
  [OM_FIELD_KEYWORDS.options]: (value) => {
    if (!Array.isArray(value)) return 'x-om-options must be an array of `{ value, label }` entries.'
    for (const option of value) {
      if (!option || typeof option !== 'object') return 'Each option must be an object.'
      const candidate = option as Record<string, unknown>
      if (typeof candidate.value !== 'string') return 'Each option must declare a string `value`.'
      if (!localizedTextValid(candidate.label)) return 'Each option must declare a localized `label` map.'
    }
    return null
  },
  [OM_FIELD_KEYWORDS.min]: (value) =>
    typeof value === 'number' && Number.isFinite(value) ? null : 'x-om-min must be a finite number.',
  [OM_FIELD_KEYWORDS.max]: (value) =>
    typeof value === 'number' && Number.isFinite(value) ? null : 'x-om-max must be a finite number.',
  [OM_FIELD_KEYWORDS.widget]: (value) =>
    typeof value === 'string' ? null : 'x-om-widget must be a widget identifier string.',
}

// ============================================================================
// AJV registration — register OM keywords as no-op annotations so AJV does
// not treat them as unknown keywords during schema compilation.
// ============================================================================

/**
 * Register every `x-om-*` keyword on the given AJV instance as an annotation
 * (no validation effect). The compiler validates the extension payload
 * separately via `OM_ROOT_VALIDATORS` / `OM_FIELD_VALIDATORS`.
 */
export function addOmKeywords(ajv: Ajv): void {
  for (const keyword of OM_ALL_KEYWORDS) {
    if (ajv.getKeyword(keyword)) continue
    ajv.addKeyword({
      keyword,
      schemaType: ['string', 'number', 'boolean', 'object', 'array'],
      // No validator — purely annotation. Returning true keeps schemas valid.
      validate: () => true,
    })
  }
}
