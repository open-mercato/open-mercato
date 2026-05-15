import { createHash } from 'node:crypto'
import type { ComponentType } from 'react'
import { FIELD_TYPE_DEFAULT_PATTERNS } from './field-type-patterns'

/**
 * FieldTypeSpec — every field type the studio offers must register one entry.
 *
 * Required trio: `validator`, `defaultUiSchema`, `exportAdapter`. `renderer`
 * is intentionally nullable in phase 1a — phase 1d (FormRunner) populates it
 * via a separate `setRenderer(typeKey, component)` call so the registry shape
 * stays stable across phases.
 *
 * Visual builder metadata (`category`, `icon`, `displayNameKey`) is additive
 * (see `.ai/specs/2026-05-10-forms-visual-builder.md` Phase A). All three are
 * optional so prior registrations stay compatible; the studio applies sane
 * defaults (`category` → `'input'`, `icon` → fallback `'square'`).
 */
export type FieldTypeSpec = {
  /**
   * Validates a single field value against the field schema node. Returns
   * `true` when the value is acceptable, or a human-readable error message
   * string otherwise. The caller is responsible for short-circuiting `null` /
   * `undefined` according to JSON Schema `required` semantics.
   */
  validator: (value: unknown, fieldNode: FieldNode) => true | string
  /**
   * React component that renders this field type. Always `null` in phase 1a
   * — the renderer module (phase 1d) calls `registry.setRenderer(...)` at
   * boot time to wire concrete components without forcing this package to
   * depend on React at runtime.
   */
  renderer: ComponentType<unknown> | null
  /** Default uiSchema fragment merged onto the field's stored uiSchema. */
  defaultUiSchema: Record<string, unknown>
  /**
   * Stringifies a value for non-interactive surfaces (CSV export, PDF
   * snapshot, audit trail). Must be deterministic and lossless for the
   * scalar types; structured types (`select_many`) join with `, `.
   *
   * The optional `fieldNode` param lets registry-aware exporters consult
   * field-level `x-om-*` keywords (e.g. `opinion_scale` reads `x-om-max` to
   * render `"<value>/<max>"`). Callers that have no node available (the
   * legacy contract) may omit it — adapters MUST tolerate `undefined`.
   */
  exportAdapter: (value: unknown, fieldNode?: FieldNode) => string
  /**
   * Studio palette grouping. `'input'` types submit a value; `'layout'`
   * types are display-only (e.g. `info_block`). Defaults to `'input'`.
   */
  category?: 'input' | 'layout'
  /** Lucide icon name shown in the studio palette card. */
  icon?: string
  /** i18n key for the studio palette display name. */
  displayNameKey?: string
}

/**
 * Minimal shape of a JSON Schema property node enriched with OM extensions.
 * The compiler hands the full node to the validator so types like `scale`
 * can read `x-om-min` / `x-om-max` and `select_one` can consult
 * `x-om-options`.
 */
export type FieldNode = Record<string, unknown>

const requireString = (value: unknown): true | string =>
  typeof value === 'string' ? true : 'Expected a string value.'

const requireFiniteNumber = (value: unknown): true | string =>
  typeof value === 'number' && Number.isFinite(value) ? true : 'Expected a finite number.'

const optionValues = (fieldNode: FieldNode): string[] => {
  const options = fieldNode['x-om-options']
  if (!Array.isArray(options)) return []
  return options
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>).value : null))
    .filter((value): value is string => typeof value === 'string')
}

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
const isIsoDateTime = (value: string): boolean => !Number.isNaN(Date.parse(value))

// ============================================================================
// Built-in field type specs (v1)
// ============================================================================

export const TEXT_TYPE: FieldTypeSpec = {
  validator: (value) => (typeof value === 'string' ? true : 'Expected a string.'),
  renderer: null,
  defaultUiSchema: { widget: 'text' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
  category: 'input',
  icon: 'type',
  displayNameKey: 'forms.studio.palette.input.text',
}

export const TEXTAREA_TYPE: FieldTypeSpec = {
  validator: (value) => (typeof value === 'string' ? true : 'Expected a multi-line string.'),
  renderer: null,
  defaultUiSchema: { widget: 'textarea', rows: 4 },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
  category: 'input',
  icon: 'align-left',
  displayNameKey: 'forms.studio.palette.input.textarea',
}

export const NUMBER_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    if (!(typeof value === 'number' && Number.isFinite(value))) return 'Expected a finite number.'
    const min = fieldNode['x-om-min']
    const max = fieldNode['x-om-max']
    if (typeof min === 'number' && value < min) return `Value must be >= ${min}.`
    if (typeof max === 'number' && value > max) return `Value must be <= ${max}.`
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'number' },
  exportAdapter: (value) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : ''),
  category: 'input',
  icon: 'hash',
  displayNameKey: 'forms.studio.palette.input.number',
}

export const INTEGER_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    if (!(typeof value === 'number' && Number.isInteger(value))) return 'Expected an integer.'
    const min = fieldNode['x-om-min']
    const max = fieldNode['x-om-max']
    if (typeof min === 'number' && value < min) return `Value must be >= ${min}.`
    if (typeof max === 'number' && value > max) return `Value must be <= ${max}.`
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'integer' },
  exportAdapter: (value) => (typeof value === 'number' && Number.isInteger(value) ? String(value) : ''),
  category: 'input',
  icon: 'hash',
  displayNameKey: 'forms.studio.palette.input.integer',
}

export const BOOLEAN_TYPE: FieldTypeSpec = {
  validator: (value) => (typeof value === 'boolean' ? true : 'Expected true or false.'),
  renderer: null,
  defaultUiSchema: { widget: 'checkbox' },
  exportAdapter: (value) => (value === true ? 'Yes' : value === false ? 'No' : ''),
  category: 'input',
  icon: 'check-square',
  displayNameKey: 'forms.studio.palette.input.boolean',
}

export const YES_NO_TYPE: FieldTypeSpec = {
  validator: (value) => (typeof value === 'boolean' ? true : 'Expected true or false.'),
  renderer: null,
  defaultUiSchema: { widget: 'yes_no' },
  exportAdapter: (value) => (value === true ? 'Yes' : value === false ? 'No' : ''),
  category: 'input',
  icon: 'toggle-left',
  displayNameKey: 'forms.studio.palette.input.yesNo',
}

export const DATE_TYPE: FieldTypeSpec = {
  validator: (value) => {
    if (typeof value !== 'string') return 'Expected an ISO date string (YYYY-MM-DD).'
    return isIsoDate(value) ? true : 'Expected an ISO date string (YYYY-MM-DD).'
  },
  renderer: null,
  defaultUiSchema: { widget: 'date' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
  category: 'input',
  icon: 'calendar',
  displayNameKey: 'forms.studio.palette.input.date',
}

export const DATETIME_TYPE: FieldTypeSpec = {
  validator: (value) => {
    if (typeof value !== 'string') return 'Expected an ISO datetime string.'
    return isIsoDateTime(value) ? true : 'Expected a parseable ISO datetime.'
  },
  renderer: null,
  defaultUiSchema: { widget: 'datetime' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
  category: 'input',
  icon: 'calendar-clock',
  displayNameKey: 'forms.studio.palette.input.datetime',
}

export const SELECT_ONE_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    const result = requireString(value)
    if (result !== true) return result
    const allowed = optionValues(fieldNode)
    if (allowed.length === 0) return true
    return allowed.includes(value as string) ? true : `Value must be one of: ${allowed.join(', ')}.`
  },
  renderer: null,
  defaultUiSchema: { widget: 'select' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
  category: 'input',
  icon: 'list',
  displayNameKey: 'forms.studio.palette.input.selectOne',
}

export const SELECT_MANY_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    if (!Array.isArray(value)) return 'Expected an array of selected values.'
    const allowed = optionValues(fieldNode)
    for (const entry of value) {
      if (typeof entry !== 'string') return 'Each selected value must be a string.'
      if (allowed.length > 0 && !allowed.includes(entry)) {
        return `Each selected value must be one of: ${allowed.join(', ')}.`
      }
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'multiselect' },
  exportAdapter: (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string').join(', ') : ''),
  category: 'input',
  icon: 'list-checks',
  displayNameKey: 'forms.studio.palette.input.selectMany',
}

export const SCALE_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    const result = requireFiniteNumber(value)
    if (result !== true) return result
    if (!Number.isInteger(value as number)) return 'Scale value must be an integer.'
    const min = typeof fieldNode['x-om-min'] === 'number' ? (fieldNode['x-om-min'] as number) : 0
    const max = typeof fieldNode['x-om-max'] === 'number' ? (fieldNode['x-om-max'] as number) : 10
    if (min > max) return `Scale bounds invalid: min (${min}) must be <= max (${max}).`
    if ((value as number) < min || (value as number) > max) {
      return `Value must be between ${min} and ${max} (inclusive).`
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'scale' },
  exportAdapter: (value) => (typeof value === 'number' ? String(value) : ''),
  category: 'input',
  icon: 'sliders-horizontal',
  displayNameKey: 'forms.studio.palette.input.scale',
}

// ----------------------------------------------------------------------------
// Tier-2 format-typed inputs (Phase B of
// `.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
//
// Email / Phone / Website share the same shape: a JSON-string value that must
// match the configured pattern (default from `FIELD_TYPE_DEFAULT_PATTERNS`,
// overridable per-field via `x-om-pattern`). Empty strings pass — required-ness
// is enforced by JSON-Schema `required`, never by the field validator.
// ----------------------------------------------------------------------------

const FORMAT_REGEX_CACHE: Map<string, RegExp> = new Map()

function resolveFormatRegex(source: string): RegExp | null {
  const cached = FORMAT_REGEX_CACHE.get(source)
  if (cached) return cached
  try {
    const compiled = new RegExp(source)
    FORMAT_REGEX_CACHE.set(source, compiled)
    return compiled
  } catch {
    return null
  }
}

function makeFormatValidator(
  format: 'email' | 'phone' | 'website',
  fallbackMessage: string,
): (value: unknown, fieldNode: FieldNode) => true | string {
  return (value, fieldNode) => {
    if (typeof value !== 'string') return 'Expected a string value.'
    if (value.length === 0) return true
    const overrideRaw = fieldNode['x-om-pattern']
    const override = typeof overrideRaw === 'string' && overrideRaw.length > 0 ? overrideRaw : null
    const source = override ?? FIELD_TYPE_DEFAULT_PATTERNS[format]
    const regex = resolveFormatRegex(source)
    if (!regex) return fallbackMessage
    return regex.test(value) ? true : fallbackMessage
  }
}

export const EMAIL_TYPE: FieldTypeSpec = {
  validator: makeFormatValidator('email', 'Expected a valid email.'),
  renderer: null,
  defaultUiSchema: { widget: 'email' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
  category: 'input',
  icon: 'mail',
  displayNameKey: 'forms.studio.palette.survey.email',
}

export const PHONE_TYPE: FieldTypeSpec = {
  validator: makeFormatValidator('phone', 'Expected a valid phone.'),
  renderer: null,
  defaultUiSchema: { widget: 'phone' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
  category: 'input',
  icon: 'phone',
  displayNameKey: 'forms.studio.palette.survey.phone',
}

export const WEBSITE_TYPE: FieldTypeSpec = {
  validator: makeFormatValidator('website', 'Expected a valid URL.'),
  renderer: null,
  defaultUiSchema: { widget: 'website' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
  category: 'input',
  icon: 'globe',
  displayNameKey: 'forms.studio.palette.survey.website',
}

// ----------------------------------------------------------------------------
// Address — composite type (Phase C of
// `.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
//
// Decision 1 — single field key with a JSON-object value. Sub-fields:
// `street1` / `city` / `country` are required; `street2` / `region` /
// `postalCode` are optional. The persisted JSON Schema fragment carries
// `type: 'object'`, the canonical `properties` map, `required`, and
// `additionalProperties: false` so AJV rejects unknown sub-keys.
// ----------------------------------------------------------------------------

const ADDRESS_REQUIRED_SUB_FIELDS = ['street1', 'city', 'country'] as const
const ADDRESS_OPTIONAL_SUB_FIELDS = ['street2', 'region', 'postalCode'] as const
const ADDRESS_KNOWN_SUB_FIELDS = new Set<string>([
  ...ADDRESS_REQUIRED_SUB_FIELDS,
  ...ADDRESS_OPTIONAL_SUB_FIELDS,
])

function addressExportSegments(value: Record<string, unknown>): string[] {
  const segments: string[] = []
  const street1 = typeof value.street1 === 'string' ? value.street1.trim() : ''
  const street2 = typeof value.street2 === 'string' ? value.street2.trim() : ''
  const city = typeof value.city === 'string' ? value.city.trim() : ''
  const region = typeof value.region === 'string' ? value.region.trim() : ''
  const postalCode = typeof value.postalCode === 'string' ? value.postalCode.trim() : ''
  const country = typeof value.country === 'string' ? value.country.trim() : ''
  if (street1) segments.push(street1)
  if (street2) segments.push(street2)
  if (city) segments.push(city)
  const regionPostal = [region, postalCode].filter((entry) => entry.length > 0).join(' ')
  if (regionPostal) segments.push(regionPostal)
  if (country) segments.push(country)
  return segments
}

export const ADDRESS_TYPE: FieldTypeSpec = {
  // Runtime UI translates the literal "Please complete the required address
  // fields." back to `forms.runner.validation.address.required` when present
  // (the validator has no locale at this layer — see Phase C § Validation
  // service in the spec).
  validator: (value) => {
    if (value === null || value === undefined) return true
    if (typeof value !== 'object' || Array.isArray(value)) {
      return 'Address must be an object.'
    }
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (!ADDRESS_KNOWN_SUB_FIELDS.has(key)) {
        return 'Address contains unknown fields.'
      }
    }
    for (const required of ADDRESS_REQUIRED_SUB_FIELDS) {
      const entry = record[required]
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        return 'Please complete the required address fields.'
      }
    }
    for (const optional of ADDRESS_OPTIONAL_SUB_FIELDS) {
      const entry = record[optional]
      if (entry === undefined) continue
      if (typeof entry !== 'string') {
        return 'Please complete the required address fields.'
      }
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'address' },
  exportAdapter: (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
    return addressExportSegments(value as Record<string, unknown>).join(', ')
  },
  category: 'input',
  icon: 'map-pin',
  displayNameKey: 'forms.studio.palette.survey.address',
}

// ----------------------------------------------------------------------------
// NPS + Opinion scale — survey types (Phase D of
// `.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
//
// Decision 2 — NPS is a distinct registered type (separate from `scale`) so the
// renderer / exporter can carry the promoter/passive/detractor semantics
// without leaking them into the generic SCALE_TYPE.
//
// `nps`: integer 0..10 (fixed). exportAdapter emits "<value> (<band>)".
// `opinion_scale`: integer respecting `x-om-min` (default 1) and `x-om-max`
//   (default 5). exportAdapter emits "<value>/<max>".
// ----------------------------------------------------------------------------

function npsBandLabel(value: number): 'Detractor' | 'Passive' | 'Promoter' {
  if (value <= 6) return 'Detractor'
  if (value <= 8) return 'Passive'
  return 'Promoter'
}

export const NPS_TYPE: FieldTypeSpec = {
  validator: (value) => {
    const result = requireFiniteNumber(value)
    if (result !== true) return result
    if (!Number.isInteger(value as number)) return 'NPS value must be an integer.'
    if ((value as number) < 0 || (value as number) > 10) {
      return 'NPS value must be between 0 and 10 (inclusive).'
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'nps' },
  exportAdapter: (value) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return ''
    if (value < 0 || value > 10) return ''
    return `${value} (${npsBandLabel(value)})`
  },
  category: 'input',
  icon: 'gauge',
  displayNameKey: 'forms.studio.palette.survey.nps',
}

export const OPINION_SCALE_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    const result = requireFiniteNumber(value)
    if (result !== true) return result
    if (!Number.isInteger(value as number)) return 'Opinion scale value must be an integer.'
    const min = typeof fieldNode['x-om-min'] === 'number' ? (fieldNode['x-om-min'] as number) : 1
    const max = typeof fieldNode['x-om-max'] === 'number' ? (fieldNode['x-om-max'] as number) : 5
    if (min > max) return `Opinion scale bounds invalid: min (${min}) must be <= max (${max}).`
    if ((value as number) < min || (value as number) > max) {
      return `Value must be between ${min} and ${max} (inclusive).`
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'opinion_scale' },
  exportAdapter: (value, fieldNode) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return ''
    const max =
      fieldNode && typeof (fieldNode as FieldNode)['x-om-max'] === 'number'
        ? ((fieldNode as FieldNode)['x-om-max'] as number)
        : 5
    return `${value}/${max}`
  },
  category: 'input',
  icon: 'star',
  displayNameKey: 'forms.studio.palette.survey.opinion',
}

// ----------------------------------------------------------------------------
// Ranking — Phase E of
// `.ai/specs/2026-05-14-forms-tier-2-question-palette.md`.
//
// Decision 4 — partial rankings are accepted by default; authors opt into
// `x-om-ranking-exhaustive: true` to require every option ranked.
//
// Persisted value shape: an array of option-value strings in user-chosen rank
// order. Each entry must belong to `x-om-options[*].value`; duplicates are
// rejected. The exporter emits `A > B > C` for exhaustive rankings and
// `A > B (partial; N unranked)` when the rank order does not cover every
// option (R-5 mitigation — partial rankings are surfaced to consumers).
// ----------------------------------------------------------------------------

export const RANKING_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    if (value === null || value === undefined) return true
    if (!Array.isArray(value)) return 'Expected an array of ranked option values.'
    const allowed = optionValues(fieldNode)
    const seen = new Set<string>()
    for (const entry of value) {
      if (typeof entry !== 'string') return 'Each ranked entry must be a string.'
      if (seen.has(entry)) return `Duplicate ranked entry "${entry}".`
      seen.add(entry)
      if (allowed.length > 0 && !allowed.includes(entry)) {
        return `Each ranked entry must be one of: ${allowed.join(', ')}.`
      }
    }
    const exhaustive = (fieldNode as Record<string, unknown>)['x-om-ranking-exhaustive']
    if (exhaustive === true && value.length !== allowed.length) {
      return 'Please rank every option.'
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'ranking' },
  exportAdapter: (value, fieldNode) => {
    if (!Array.isArray(value)) return ''
    const ordered = value.filter((entry): entry is string => typeof entry === 'string')
    const joined = ordered.join(' > ')
    if (!fieldNode) return joined
    const totalOptions = optionValues(fieldNode as FieldNode).length
    const exhaustive = (fieldNode as Record<string, unknown>)['x-om-ranking-exhaustive'] === true
    if (totalOptions === 0) return joined
    if (exhaustive) return joined
    const missing = totalOptions - ordered.length
    if (missing > 0) {
      return `${joined} (partial; ${missing} unranked)`
    }
    return joined
  },
  category: 'input',
  icon: 'list-ordered',
  displayNameKey: 'forms.studio.palette.survey.ranking',
}

// ----------------------------------------------------------------------------
// Matrix / Likert — Phase F of
// `.ai/specs/2026-05-14-forms-tier-2-question-palette.md`.
//
// Decision 5 — per-row `multiple: true` opt-in. A row's value is either:
//   - a single string (default — radio per row), OR
//   - a string[] (when the row declares `multiple: true` — checkbox per row).
//
// Persisted shape is `Record<rowKey, string | string[]>`. The author defines
// the row catalog via `x-om-matrix-rows` and the column catalog via
// `x-om-matrix-columns`. R-3 soft caps live in `jsonschema-extensions.ts` and
// fire from `validateOmCrossKeyword`.
// ----------------------------------------------------------------------------

type MatrixRowNode = {
  key: string
  label?: Record<string, string>
  multiple?: boolean
  required?: boolean
}

type MatrixColumnNode = {
  value: string
  label?: Record<string, string>
}

function readMatrixRows(fieldNode: FieldNode): MatrixRowNode[] {
  const raw = (fieldNode as Record<string, unknown>)['x-om-matrix-rows']
  if (!Array.isArray(raw)) return []
  const result: MatrixRowNode[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.key !== 'string') continue
    const row: MatrixRowNode = { key: candidate.key }
    if (candidate.label && typeof candidate.label === 'object' && !Array.isArray(candidate.label)) {
      row.label = candidate.label as Record<string, string>
    }
    if (typeof candidate.multiple === 'boolean') row.multiple = candidate.multiple
    if (typeof candidate.required === 'boolean') row.required = candidate.required
    result.push(row)
  }
  return result
}

function readMatrixColumnValues(fieldNode: FieldNode): string[] {
  const raw = (fieldNode as Record<string, unknown>)['x-om-matrix-columns']
  if (!Array.isArray(raw)) return []
  const values: string[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.value === 'string' && candidate.value.length > 0) {
      values.push(candidate.value)
    }
  }
  return values
}

export const MATRIX_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    if (value === null || value === undefined) return true
    if (typeof value !== 'object' || Array.isArray(value)) {
      return 'Matrix value must be an object keyed by row key.'
    }
    const record = value as Record<string, unknown>
    const rows = readMatrixRows(fieldNode)
    const rowsByKey = new Map<string, MatrixRowNode>()
    for (const row of rows) rowsByKey.set(row.key, row)
    const columnValues = readMatrixColumnValues(fieldNode)
    const columnSet = new Set(columnValues)
    for (const presentKey of Object.keys(record)) {
      if (!rowsByKey.has(presentKey)) {
        return `Matrix value references unknown row "${presentKey}".`
      }
    }
    for (const row of rows) {
      const entry = record[row.key]
      const isMissing =
        entry === undefined
        || entry === null
        || (Array.isArray(entry) && entry.length === 0)
        || (typeof entry === 'string' && entry.length === 0)
      if (row.required === true && isMissing) {
        return 'Please answer every required row.'
      }
      if (isMissing) continue
      if (row.multiple === true) {
        if (!Array.isArray(entry)) {
          return `Matrix row "${row.key}" expects an array of selected column values.`
        }
        const seen = new Set<string>()
        for (const inner of entry) {
          if (typeof inner !== 'string') {
            return `Matrix row "${row.key}" entries must be strings.`
          }
          if (seen.has(inner)) {
            return `Matrix row "${row.key}" contains duplicate value "${inner}".`
          }
          seen.add(inner)
          if (columnSet.size > 0 && !columnSet.has(inner)) {
            return `Matrix row "${row.key}" value "${inner}" is not a declared column.`
          }
        }
      } else {
        if (Array.isArray(entry)) {
          return `Matrix row "${row.key}" expects a single column value, not an array.`
        }
        if (typeof entry !== 'string') {
          return `Matrix row "${row.key}" expects a single column value.`
        }
        if (columnSet.size > 0 && !columnSet.has(entry)) {
          return `Matrix row "${row.key}" value "${entry}" is not a declared column.`
        }
      }
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'matrix' },
  exportAdapter: (value, fieldNode) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
    const record = value as Record<string, unknown>
    if (!fieldNode) {
      const fallback: string[] = []
      for (const [rowKey, entry] of Object.entries(record)) {
        if (Array.isArray(entry)) {
          const joined = entry.filter((inner): inner is string => typeof inner === 'string').join('+')
          fallback.push(`${rowKey} → ${joined.length > 0 ? joined : '—'}`)
        } else if (typeof entry === 'string' && entry.length > 0) {
          fallback.push(`${rowKey} → ${entry}`)
        } else {
          fallback.push(`${rowKey} → —`)
        }
      }
      return fallback.join('; ')
    }
    const rows = readMatrixRows(fieldNode as FieldNode)
    const segments: string[] = []
    for (const row of rows) {
      const labelEn = row.label?.en ?? row.key
      const entry = record[row.key]
      if (Array.isArray(entry)) {
        const inner = entry.filter((value): value is string => typeof value === 'string')
        segments.push(`${labelEn} → ${inner.length > 0 ? inner.join('+') : '—'}`)
      } else if (typeof entry === 'string' && entry.length > 0) {
        segments.push(`${labelEn} → ${entry}`)
      } else {
        segments.push(`${labelEn} → —`)
      }
    }
    return segments.join('; ')
  },
  category: 'input',
  icon: 'grid-3x3',
  displayNameKey: 'forms.studio.palette.survey.matrix',
}

export const INFO_BLOCK_TYPE: FieldTypeSpec = {
  // Display-only — never produces a submission value, never fails validation.
  validator: () => true,
  renderer: null,
  defaultUiSchema: { widget: 'info' },
  exportAdapter: () => '',
  // Decision 7a (2026-05-10 grill): info_block is the single LAYOUT entry for
  // display-only headings/text. No parallel "Heading" primitive.
  category: 'layout',
  icon: 'heading',
  displayNameKey: 'forms.studio.palette.layout.infoBlock',
}

export const V1_FIELD_TYPES = {
  text: TEXT_TYPE,
  textarea: TEXTAREA_TYPE,
  number: NUMBER_TYPE,
  integer: INTEGER_TYPE,
  boolean: BOOLEAN_TYPE,
  yes_no: YES_NO_TYPE,
  date: DATE_TYPE,
  datetime: DATETIME_TYPE,
  select_one: SELECT_ONE_TYPE,
  select_many: SELECT_MANY_TYPE,
  scale: SCALE_TYPE,
  info_block: INFO_BLOCK_TYPE,
  // Tier-2 additive entries — Phase B (Survey & Contact group). Despite the
  // legacy `V1_FIELD_TYPES` name, these are NOT v1-core; the FROZEN v1 list
  // in `packages/forms/AGENTS.md § "v1 Field Types"` is unchanged.
  email: EMAIL_TYPE,
  phone: PHONE_TYPE,
  website: WEBSITE_TYPE,
  // Tier-2 additive entry — Phase C (composite address, Decision 1).
  address: ADDRESS_TYPE,
  // Tier-2 additive entries — Phase D (survey scales).
  // Decision 2 — NPS is a distinct registered type, not a `scale` variant.
  nps: NPS_TYPE,
  opinion_scale: OPINION_SCALE_TYPE,
  // Tier-2 additive entry — Phase E (ranking — drag-to-rank list).
  ranking: RANKING_TYPE,
  // Tier-2 additive entry — Phase F (matrix / Likert grid).
  // Decision 5 — per-row `multiple: true` opt-in produces a string[] value.
  matrix: MATRIX_TYPE,
} as const

export type V1FieldTypeKey = keyof typeof V1_FIELD_TYPES

// ============================================================================
// Registry
// ============================================================================

/**
 * FieldTypeRegistry — singleton lookup keyed by `x-om-type` string.
 *
 * The registry version is a SHA-256 of the registered keys (sorted) — it
 * changes when types are added/removed and is captured on
 * `form_version.registry_version` at publish time so the renderer can detect
 * registry drift between publish and render (R2 mitigation, parent spec
 * § Risks).
 */
export class FieldTypeRegistry {
  private readonly entries = new Map<string, FieldTypeSpec>()
  private cachedVersion: string | null = null

  register(typeKey: string, spec: FieldTypeSpec): void {
    if (spec.category === 'layout') {
      // Layout-category entries are display-only (Decisions 16a/16b in
      // `.ai/specs/2026-05-10-forms-visual-builder.md`). The registry asserts
      // the `info_block` contract at register time so packs can't ship
      // value-producing or non-empty-export fields under `category: 'layout'`.
      const validatorResult = spec.validator(undefined, {})
      if (validatorResult !== true) {
        throw new Error(
          `Field type "${typeKey}" registered with category "layout" must accept undefined values; validator returned: ${String(validatorResult)}`,
        )
      }
      const exportResult = spec.exportAdapter(undefined)
      if (exportResult !== '') {
        throw new Error(
          `Field type "${typeKey}" registered with category "layout" must export undefined as the empty string; exportAdapter returned: ${JSON.stringify(exportResult)}`,
        )
      }
    }
    this.entries.set(typeKey, spec)
    this.cachedVersion = null
  }

  setRenderer(typeKey: string, renderer: ComponentType<unknown>): void {
    const existing = this.entries.get(typeKey)
    if (!existing) {
      throw new Error(`Field type "${typeKey}" is not registered; cannot attach renderer.`)
    }
    this.entries.set(typeKey, { ...existing, renderer })
  }

  get(typeKey: string): FieldTypeSpec | undefined {
    return this.entries.get(typeKey)
  }

  has(typeKey: string): boolean {
    return this.entries.has(typeKey)
  }

  keys(): string[] {
    return Array.from(this.entries.keys()).sort()
  }

  /**
   * Stable hash over the registered keys. Bumps whenever types are added or
   * removed; pinned at publish time on `form_version.registry_version`.
   */
  getRegistryVersion(): string {
    if (this.cachedVersion) return this.cachedVersion
    const hash = createHash('sha256').update(this.keys().join('|')).digest('hex').slice(0, 16)
    this.cachedVersion = `v1:${hash}`
    return this.cachedVersion
  }
}

/**
 * Pre-loaded singleton with the 11 v1 core types. Phase 1d's renderer
 * calls `defaultFieldTypeRegistry.setRenderer(...)` at module init.
 */
export const defaultFieldTypeRegistry = new FieldTypeRegistry()
for (const [key, spec] of Object.entries(V1_FIELD_TYPES)) {
  defaultFieldTypeRegistry.register(key, spec)
}
