/**
 * Workflows Module - Sub-workflow Port Contract Validation
 *
 * Coerces and validates a flat values object against a declared list of port
 * fields (the `definition.io.inputs` / `definition.io.outputs` contract). Used
 * at the SUB_WORKFLOW boundary so mapped inputs entering a child and mapped
 * outputs leaving it conform to the child's declared, business-user-authored
 * contract.
 *
 * Validation is opt-in by contract presence: the caller only invokes this when
 * a child declares ports, so legacy untyped sub-workflows are unaffected.
 *
 * Coercion is intentionally permissive on representation (numeric strings,
 * boolean tokens, ISO/epoch dates) but strict on validity — an uncoercible
 * value or a missing required port produces an error rather than silently
 * dropping the field.
 */

import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { PortField } from '../data/validators'

export interface PortValidationError {
  port: string
  message: string
}

export interface PortValidationResult {
  coerced: Record<string, any>
  errors: PortValidationError[]
}

/**
 * Validate and coerce `values` against the declared `ports`.
 *
 * Declared ports are coerced into the contract's type; keys not covered by a
 * port pass through unchanged (so a partial contract does not strip unrelated
 * context). A required port that is absent, or a value that cannot be coerced
 * to its declared type, is reported as an error.
 */
export function validateAgainstPorts(
  values: Record<string, any> | null | undefined,
  ports: PortField[],
): PortValidationResult {
  const source = values ?? {}
  const coerced: Record<string, any> = { ...source }
  const errors: PortValidationError[] = []

  for (const port of ports) {
    const raw = source[port.name]
    const isAbsent = raw === undefined || raw === null || raw === ''

    if (isAbsent) {
      if (port.required) {
        errors.push({ port: port.name, message: `Required port "${port.name}" is missing` })
      }
      continue
    }

    const result = coercePortValue(raw, port)
    if (result.error) {
      errors.push({ port: port.name, message: result.error })
      continue
    }
    coerced[port.name] = result.value
  }

  return { coerced, errors }
}

function coercePortValue(raw: any, port: PortField): { value?: any; error?: string } {
  switch (port.type) {
    case 'text':
      return { value: String(raw) }

    case 'number': {
      const parsed = typeof raw === 'number' ? raw : Number(raw)
      return Number.isNaN(parsed)
        ? { error: `Port "${port.name}" expects a number` }
        : { value: parsed }
    }

    case 'boolean': {
      const parsed = typeof raw === 'boolean' ? raw : parseBooleanToken(typeof raw === 'string' ? raw : String(raw))
      return parsed === null
        ? { error: `Port "${port.name}" expects a boolean` }
        : { value: parsed }
    }

    case 'select': {
      const text = String(raw)
      if (port.options && port.options.length > 0 && !port.options.includes(text)) {
        return { error: `Port "${port.name}" must be one of: ${port.options.join(', ')}` }
      }
      return { value: text }
    }

    case 'date': {
      const date = raw instanceof Date ? raw : new Date(typeof raw === 'number' ? raw : String(raw))
      return Number.isNaN(date.getTime())
        ? { error: `Port "${port.name}" expects a valid date` }
        : { value: date.toISOString() }
    }

    default:
      return { value: raw }
  }
}
