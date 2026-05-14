import type Ajv from 'ajv'
import { validateJsonLogicGrammar } from './jsonlogic-grammar'

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
  /** Page rendering mode — `'stacked'` (default) renders all pages at once; `'paginated'` shows one page at a time. */
  pageMode: 'x-om-page-mode',
  /** Locales the form supports (additive, default `['en']`). */
  supportedLocales: 'x-om-supported-locales',
  /** Theme density (additive, default `'default'`). Decision 20a. */
  formStyle: 'x-om-form-style',
  /** Form-level label position (additive, default `'top'`; mobile collapses `'left'` → `'top'`). Decision 20b. */
  formLabelPosition: 'x-om-form-label-position',
  /** Show progress indicator (additive, default `false`). Active only when paginated AND pages >= 2 (Decision 20c). */
  showProgress: 'x-om-show-progress',
  /** Ordered jump rules — branch from a page/field to a target page, ending, or submit. Reactive-core spec. */
  jumps: 'x-om-jumps',
  /** Named computed variables — render-only, recomputed from answers + hidden + earlier variables. Reactive-core spec. */
  variables: 'x-om-variables',
  /** Declared hidden-field context names — populated from URL query params at runtime. Reactive-core spec. */
  hiddenFields: 'x-om-hidden-fields',
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
  /**
   * Persisted column span within the parent section's grid (1..4). Read-time
   * clamping against the section's `columns` is the renderer's job — the
   * validator never rewrites the persisted value (Decision 3a).
   */
  gridSpan: 'x-om-grid-span',
  /** Field alignment within its grid cell. Wired by Phase D — keyword declared now for forward consistency. */
  align: 'x-om-align',
  /** Hide the field on mobile viewport only. Wired by Phase D — keyword declared now for forward consistency. */
  hideMobile: 'x-om-hide-mobile',
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

export type OmSectionKind = 'page' | 'section' | 'ending'
export type OmSectionColumns = 1 | 2 | 3 | 4
export type OmSectionGap = 'sm' | 'md' | 'lg'

export type OmSection = {
  key: string
  title: LocalizedText
  fieldKeys: string[]
  /** `'page'` marks a page boundary; `'section'` (default) is a regular group; `'ending'` is a terminal screen reached via jumps. */
  kind?: OmSectionKind
  /** Number of grid columns inside this section. Default `1`, applied at read time. Decision 9. */
  columns?: OmSectionColumns
  /** Grid gap mapping. Default `'md'`, applied at read time. Decision 9. */
  gap?: OmSectionGap
  /** When `true`, render a `Separator` below the section header. Decision 9. */
  divider?: boolean
  /** Suppress the section H2 even when `title` is non-empty. Decision 7b. */
  hideTitle?: boolean
  /** Section-level visibility predicate (reactive-core spec). Hidden sections cascade — their fields are treated as hidden too. Disallowed on `kind: 'ending'`. */
  'x-om-visibility-if'?: unknown
  /** Optional absolute or relative URL to redirect to after submit. Only valid when `kind === 'ending'`. */
  'x-om-redirect-url'?: string | null
}

export type OmJumpTarget =
  | { type: 'page'; pageKey: string }
  | { type: 'ending'; endingKey: string }
  | { type: 'next' }
  | { type: 'submit' }

export type OmJumpRule = {
  from: { type: 'page'; pageKey: string } | { type: 'field'; fieldKey: string }
  rules: Array<{ if: unknown; goto: OmJumpTarget }>
  otherwise?: OmJumpTarget
}

export type OmFormVariableType = 'number' | 'boolean' | 'string'

export type OmFormVariable = {
  name: string
  type: OmFormVariableType
  formula: unknown
  default?: number | boolean | string
}

export type OmHiddenFieldDecl = {
  name: string
  defaultValue?: string
}

export type OmPageMode = 'stacked' | 'paginated'
export type OmFormStyle = 'default' | 'compact' | 'spacious'
export type OmFormLabelPosition = 'top' | 'left'

export type OmRootExtensions = {
  [OM_ROOT_KEYWORDS.roles]?: string[]
  [OM_ROOT_KEYWORDS.defaultActorRole]?: string
  [OM_ROOT_KEYWORDS.sections]?: OmSection[]
  [OM_ROOT_KEYWORDS.pageMode]?: OmPageMode
  [OM_ROOT_KEYWORDS.supportedLocales]?: string[]
  [OM_ROOT_KEYWORDS.formStyle]?: OmFormStyle
  [OM_ROOT_KEYWORDS.formLabelPosition]?: OmFormLabelPosition
  [OM_ROOT_KEYWORDS.showProgress]?: boolean
  [OM_ROOT_KEYWORDS.jumps]?: OmJumpRule[]
  [OM_ROOT_KEYWORDS.variables]?: OmFormVariable[]
  [OM_ROOT_KEYWORDS.hiddenFields]?: OmHiddenFieldDecl[]
}

export type OmFieldOption = {
  value: string
  label: LocalizedText
}

export type OmFieldGridSpan = 1 | 2 | 3 | 4
export type OmFieldAlign = 'start' | 'center' | 'end'

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
  [OM_FIELD_KEYWORDS.gridSpan]?: OmFieldGridSpan
  [OM_FIELD_KEYWORDS.align]?: OmFieldAlign
  [OM_FIELD_KEYWORDS.hideMobile]?: boolean
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

const VALID_SECTION_KINDS: ReadonlySet<string> = new Set(['page', 'section', 'ending'])
const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/
const VALID_VARIABLE_TYPES: ReadonlySet<string> = new Set(['number', 'boolean', 'string'])
const VALID_JUMP_TARGET_TYPES: ReadonlySet<string> = new Set(['page', 'ending', 'next', 'submit'])
const VALID_JUMP_FROM_TYPES: ReadonlySet<string> = new Set(['page', 'field'])

function isJumpTargetValid(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.type !== 'string' || !VALID_JUMP_TARGET_TYPES.has(candidate.type)) return false
  if (candidate.type === 'page') return typeof candidate.pageKey === 'string' && candidate.pageKey.length > 0
  if (candidate.type === 'ending') return typeof candidate.endingKey === 'string' && candidate.endingKey.length > 0
  return true
}
const VALID_SECTION_COLUMNS: ReadonlySet<number> = new Set([1, 2, 3, 4])
const VALID_SECTION_GAPS: ReadonlySet<string> = new Set(['sm', 'md', 'lg'])
const VALID_FIELD_GRID_SPANS: ReadonlySet<number> = new Set([1, 2, 3, 4])
const VALID_FIELD_ALIGN: ReadonlySet<string> = new Set(['start', 'center', 'end'])
const VALID_PAGE_MODES: ReadonlySet<string> = new Set(['stacked', 'paginated'])
const VALID_FORM_STYLES: ReadonlySet<string> = new Set(['default', 'compact', 'spacious'])
const VALID_FORM_LABEL_POSITIONS: ReadonlySet<string> = new Set(['top', 'left'])

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
    const seenKeys = new Set<string>()
    for (const section of value) {
      if (!section || typeof section !== 'object') return 'Each section must be an object.'
      const candidate = section as Record<string, unknown>
      if (typeof candidate.key !== 'string') return 'Each section must declare a string `key`.'
      if (seenKeys.has(candidate.key)) {
        return `Duplicate section key "${candidate.key}" — section keys must be unique within x-om-sections.`
      }
      seenKeys.add(candidate.key)
      if (!localizedTextValid(candidate.title)) return 'Each section must declare a localized `title` map.'
      if (!stringArrayValid(candidate.fieldKeys)) return 'Each section must declare a string array `fieldKeys`.'
      if (candidate.kind !== undefined) {
        if (typeof candidate.kind !== 'string' || !VALID_SECTION_KINDS.has(candidate.kind)) {
          return 'Section `kind` must be "page", "section", or "ending" when present.'
        }
      }
      if (candidate.columns !== undefined) {
        if (typeof candidate.columns !== 'number' || !VALID_SECTION_COLUMNS.has(candidate.columns)) {
          return 'Section `columns` must be an integer in [1, 4] when present.'
        }
      }
      if (candidate.gap !== undefined) {
        if (typeof candidate.gap !== 'string' || !VALID_SECTION_GAPS.has(candidate.gap)) {
          return 'Section `gap` must be "sm", "md", or "lg" when present.'
        }
      }
      if (candidate.divider !== undefined && typeof candidate.divider !== 'boolean') {
        return 'Section `divider` must be a boolean when present.'
      }
      if (candidate.hideTitle !== undefined && typeof candidate.hideTitle !== 'boolean') {
        return 'Section `hideTitle` must be a boolean when present.'
      }
      const redirect = candidate['x-om-redirect-url']
      if (redirect !== undefined) {
        if (candidate.kind !== 'ending') {
          return `Section "${candidate.key}" declares x-om-redirect-url but kind is not "ending".`
        }
        if (redirect !== null && typeof redirect !== 'string') {
          return `Section "${candidate.key}" x-om-redirect-url must be a string or null when present.`
        }
      }
      if (candidate.kind === 'ending' && candidate['x-om-visibility-if'] !== undefined) {
        return `Ending section "${candidate.key}" must not declare x-om-visibility-if — endings are reached via jumps only.`
      }
    }
    return null
  },
  [OM_ROOT_KEYWORDS.pageMode]: (value) =>
    typeof value === 'string' && VALID_PAGE_MODES.has(value)
      ? null
      : 'x-om-page-mode must be "stacked" or "paginated".',
  [OM_ROOT_KEYWORDS.supportedLocales]: (value) =>
    stringArrayValid(value) ? null : 'x-om-supported-locales must be an array of locale strings.',
  [OM_ROOT_KEYWORDS.formStyle]: (value) =>
    typeof value === 'string' && VALID_FORM_STYLES.has(value)
      ? null
      : 'x-om-form-style must be "default", "compact", or "spacious".',
  [OM_ROOT_KEYWORDS.formLabelPosition]: (value) =>
    typeof value === 'string' && VALID_FORM_LABEL_POSITIONS.has(value)
      ? null
      : 'x-om-form-label-position must be "top" or "left".',
  [OM_ROOT_KEYWORDS.showProgress]: (value) =>
    typeof value === 'boolean' ? null : 'x-om-show-progress must be a boolean.',
  [OM_ROOT_KEYWORDS.jumps]: (value) => {
    if (!Array.isArray(value)) return 'x-om-jumps must be an array of jump rules.'
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') return 'Each jump rule must be an object.'
      const candidate = entry as Record<string, unknown>
      const from = candidate.from
      if (!from || typeof from !== 'object') {
        return 'Each jump rule must declare a `from` source object.'
      }
      const fromCandidate = from as Record<string, unknown>
      if (typeof fromCandidate.type !== 'string' || !VALID_JUMP_FROM_TYPES.has(fromCandidate.type)) {
        return 'Jump rule `from.type` must be "page" or "field".'
      }
      if (fromCandidate.type === 'page' && typeof fromCandidate.pageKey !== 'string') {
        return 'Jump rule with `from.type` "page" must declare `from.pageKey` string.'
      }
      if (fromCandidate.type === 'field' && typeof fromCandidate.fieldKey !== 'string') {
        return 'Jump rule with `from.type` "field" must declare `from.fieldKey` string.'
      }
      if (!Array.isArray(candidate.rules)) {
        return 'Jump rule must declare a `rules` array.'
      }
      for (const rule of candidate.rules) {
        if (!rule || typeof rule !== 'object') return 'Each jump entry must be an object.'
        const ruleCandidate = rule as Record<string, unknown>
        if (!('if' in ruleCandidate)) return 'Each jump entry must declare an `if` predicate.'
        if (!isJumpTargetValid(ruleCandidate.goto)) return 'Each jump entry must declare a valid `goto` target.'
      }
      if (candidate.otherwise !== undefined && !isJumpTargetValid(candidate.otherwise)) {
        return 'Jump rule `otherwise` must be a valid jump target when present.'
      }
    }
    return null
  },
  [OM_ROOT_KEYWORDS.variables]: (value) => {
    if (!Array.isArray(value)) return 'x-om-variables must be an array of variable declarations.'
    const seenNames = new Set<string>()
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') return 'Each variable must be an object.'
      const candidate = entry as Record<string, unknown>
      if (typeof candidate.name !== 'string' || !VARIABLE_NAME_PATTERN.test(candidate.name)) {
        return 'Each variable must declare a `name` matching /^[a-z][a-z0-9_]*$/.'
      }
      if (seenNames.has(candidate.name)) {
        return `Duplicate variable name "${candidate.name}".`
      }
      seenNames.add(candidate.name)
      if (typeof candidate.type !== 'string' || !VALID_VARIABLE_TYPES.has(candidate.type)) {
        return `Variable "${candidate.name}" type must be "number", "boolean", or "string".`
      }
      if (!('formula' in candidate)) {
        return `Variable "${candidate.name}" must declare a \`formula\`.`
      }
      if (candidate.default !== undefined) {
        const t = candidate.type
        const d = candidate.default
        if (t === 'number' && typeof d !== 'number') return `Variable "${candidate.name}" default must be a number.`
        if (t === 'boolean' && typeof d !== 'boolean') return `Variable "${candidate.name}" default must be a boolean.`
        if (t === 'string' && typeof d !== 'string') return `Variable "${candidate.name}" default must be a string.`
      }
    }
    return null
  },
  [OM_ROOT_KEYWORDS.hiddenFields]: (value) => {
    if (!Array.isArray(value)) return 'x-om-hidden-fields must be an array of declarations.'
    const seenNames = new Set<string>()
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') return 'Each hidden field must be an object.'
      const candidate = entry as Record<string, unknown>
      if (typeof candidate.name !== 'string' || !VARIABLE_NAME_PATTERN.test(candidate.name)) {
        return 'Each hidden field must declare a `name` matching /^[a-z][a-z0-9_]*$/.'
      }
      if (seenNames.has(candidate.name)) {
        return `Duplicate hidden field name "${candidate.name}".`
      }
      seenNames.add(candidate.name)
      if (candidate.defaultValue !== undefined && typeof candidate.defaultValue !== 'string') {
        return `Hidden field "${candidate.name}" defaultValue must be a string when present.`
      }
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
  [OM_FIELD_KEYWORDS.gridSpan]: (value) =>
    typeof value === 'number' && Number.isInteger(value) && VALID_FIELD_GRID_SPANS.has(value)
      ? null
      : 'x-om-grid-span must be an integer in [1, 4].',
  [OM_FIELD_KEYWORDS.align]: (value) =>
    typeof value === 'string' && VALID_FIELD_ALIGN.has(value)
      ? null
      : 'x-om-align must be "start", "center", or "end".',
  [OM_FIELD_KEYWORDS.hideMobile]: (value) =>
    typeof value === 'boolean' ? null : 'x-om-hide-mobile must be a boolean.',
}

// ============================================================================
// Cross-keyword validation — collisions between identifier namespaces and
// jsonlogic grammar checks on persisted expressions. Returns the first
// violation message or `null` when the schema is consistent.
// ============================================================================

export function validateOmCrossKeyword(schema: Record<string, unknown>): string | null {
  const propertyKeys = readPropertyKeys(schema)
  const sections = Array.isArray(schema[OM_ROOT_KEYWORDS.sections])
    ? (schema[OM_ROOT_KEYWORDS.sections] as Array<Record<string, unknown>>)
    : []
  const hiddenDecls = Array.isArray(schema[OM_ROOT_KEYWORDS.hiddenFields])
    ? (schema[OM_ROOT_KEYWORDS.hiddenFields] as Array<Record<string, unknown>>)
    : []
  const variableDecls = Array.isArray(schema[OM_ROOT_KEYWORDS.variables])
    ? (schema[OM_ROOT_KEYWORDS.variables] as Array<Record<string, unknown>>)
    : []
  const jumps = Array.isArray(schema[OM_ROOT_KEYWORDS.jumps])
    ? (schema[OM_ROOT_KEYWORDS.jumps] as Array<Record<string, unknown>>)
    : []

  const hiddenNames = hiddenDecls.map((entry) => entry?.name).filter((name): name is string => typeof name === 'string')
  const variableNames = variableDecls.map((entry) => entry?.name).filter((name): name is string => typeof name === 'string')

  for (const name of hiddenNames) {
    if (propertyKeys.has(name)) {
      return `Hidden field name "${name}" collides with a field key in properties.`
    }
  }
  for (const name of variableNames) {
    if (propertyKeys.has(name)) {
      return `Variable name "${name}" collides with a field key in properties.`
    }
    if (hiddenNames.includes(name)) {
      return `Variable name "${name}" collides with a hidden field name.`
    }
  }

  const sectionKeys = new Set<string>()
  const pageKeys = new Set<string>()
  const endingKeys = new Set<string>()
  for (const section of sections) {
    if (typeof section.key !== 'string') continue
    sectionKeys.add(section.key)
    if (section.kind === 'ending') endingKeys.add(section.key)
    else pageKeys.add(section.key)
  }

  // Validate visibility predicates (field-level + section-level).
  const properties = schema.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [fieldKey, fieldNode] of Object.entries(properties as Record<string, unknown>)) {
      if (!fieldNode || typeof fieldNode !== 'object') continue
      const predicate = (fieldNode as Record<string, unknown>)[OM_FIELD_KEYWORDS.visibilityIf]
      if (predicate !== undefined) {
        const message = validateJsonLogicGrammar(predicate)
        if (message) return `Field "${fieldKey}" x-om-visibility-if: ${message}`
      }
    }
  }
  for (const section of sections) {
    const predicate = section['x-om-visibility-if']
    if (predicate !== undefined) {
      const message = validateJsonLogicGrammar(predicate)
      if (message) return `Section "${section.key}" x-om-visibility-if: ${message}`
    }
  }

  // Validate jump rules: grammar on each `if`, resolvable goto targets.
  for (const rule of jumps) {
    const from = rule.from as Record<string, unknown> | undefined
    if (from?.type === 'page' && typeof from.pageKey === 'string' && !pageKeys.has(from.pageKey)) {
      return `Jump rule references missing page "${from.pageKey}".`
    }
    if (from?.type === 'field' && typeof from.fieldKey === 'string' && !propertyKeys.has(from.fieldKey)) {
      return `Jump rule references missing field "${from.fieldKey}".`
    }
    const rules = Array.isArray(rule.rules) ? (rule.rules as Array<Record<string, unknown>>) : []
    for (const branch of rules) {
      if (branch.if !== undefined) {
        const message = validateJsonLogicGrammar(branch.if)
        if (message) return `Jump rule predicate: ${message}`
      }
      const target = branch.goto as Record<string, unknown> | undefined
      const targetMessage = validateJumpTargetReference(target, pageKeys, endingKeys)
      if (targetMessage) return targetMessage
    }
    if (rule.otherwise) {
      const targetMessage = validateJumpTargetReference(rule.otherwise as Record<string, unknown>, pageKeys, endingKeys)
      if (targetMessage) return targetMessage
    }
  }

  // Validate variable formulas.
  for (const variable of variableDecls) {
    const formula = (variable as Record<string, unknown>).formula
    if (formula === undefined) continue
    const message = validateJsonLogicGrammar(formula)
    if (message) return `Variable "${variable.name}" formula: ${message}`
  }

  return null
}

function validateJumpTargetReference(
  target: Record<string, unknown> | undefined,
  pageKeys: Set<string>,
  endingKeys: Set<string>,
): string | null {
  if (!target) return null
  if (target.type === 'page' && typeof target.pageKey === 'string' && !pageKeys.has(target.pageKey)) {
    return `Jump goto references missing page "${target.pageKey}".`
  }
  if (target.type === 'ending' && typeof target.endingKey === 'string' && !endingKeys.has(target.endingKey)) {
    return `Jump goto references missing ending "${target.endingKey}".`
  }
  return null
}

function readPropertyKeys(schema: Record<string, unknown>): Set<string> {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return new Set()
  return new Set(Object.keys(properties as Record<string, unknown>))
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
