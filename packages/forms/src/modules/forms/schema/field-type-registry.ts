import { createHash } from 'node:crypto'
import type { ComponentType } from 'react'

/**
 * FieldTypeSpec — every field type the studio offers must register one entry.
 *
 * Required trio: `validator`, `defaultUiSchema`, `exportAdapter`. `renderer`
 * is intentionally nullable in phase 1a — phase 1d (FormRunner) populates it
 * via a separate `setRenderer(typeKey, component)` call so the registry shape
 * stays stable across phases.
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
   */
  exportAdapter: (value: unknown) => string
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
}

export const TEXTAREA_TYPE: FieldTypeSpec = {
  validator: (value) => (typeof value === 'string' ? true : 'Expected a multi-line string.'),
  renderer: null,
  defaultUiSchema: { widget: 'textarea', rows: 4 },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
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
}

export const BOOLEAN_TYPE: FieldTypeSpec = {
  validator: (value) => (typeof value === 'boolean' ? true : 'Expected true or false.'),
  renderer: null,
  defaultUiSchema: { widget: 'checkbox' },
  exportAdapter: (value) => (value === true ? 'Yes' : value === false ? 'No' : ''),
}

export const DATE_TYPE: FieldTypeSpec = {
  validator: (value) => {
    if (typeof value !== 'string') return 'Expected an ISO date string (YYYY-MM-DD).'
    return isIsoDate(value) ? true : 'Expected an ISO date string (YYYY-MM-DD).'
  },
  renderer: null,
  defaultUiSchema: { widget: 'date' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
}

export const DATETIME_TYPE: FieldTypeSpec = {
  validator: (value) => {
    if (typeof value !== 'string') return 'Expected an ISO datetime string.'
    return isIsoDateTime(value) ? true : 'Expected a parseable ISO datetime.'
  },
  renderer: null,
  defaultUiSchema: { widget: 'datetime' },
  exportAdapter: (value) => (typeof value === 'string' ? value : ''),
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
}

export const INFO_BLOCK_TYPE: FieldTypeSpec = {
  // Display-only — never produces a submission value, never fails validation.
  validator: () => true,
  renderer: null,
  defaultUiSchema: { widget: 'info' },
  exportAdapter: () => '',
}

export const V1_FIELD_TYPES = {
  text: TEXT_TYPE,
  textarea: TEXTAREA_TYPE,
  number: NUMBER_TYPE,
  integer: INTEGER_TYPE,
  boolean: BOOLEAN_TYPE,
  date: DATE_TYPE,
  datetime: DATETIME_TYPE,
  select_one: SELECT_ONE_TYPE,
  select_many: SELECT_MANY_TYPE,
  scale: SCALE_TYPE,
  info_block: INFO_BLOCK_TYPE,
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
