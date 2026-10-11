/**
 * Public-runner reactive-logic derivation (R-6 convergence).
 *
 * The public/portal+anonymous runner historically only applied role-based
 * field visibility (`schemaResponse.fieldIndex`). The reactive runner
 * (`runner/FormRunner.tsx`) additionally evaluates `x-om-visibility-if`,
 * `x-om-variables`, recall tokens, and `x-om-jumps` through the shared,
 * framework-agnostic `evaluateFormLogic` service.
 *
 * This module wraps that same service so the public hook can derive a live
 * `LogicState` from the current answers without duplicating the jsonlogic
 * engine. It is pure (no React, no I/O) so the convergence behaviour is unit
 * testable in a node environment.
 */

import { evaluateFormLogic, type LogicState } from '../../../services/form-logic-evaluator'
import type { RunnerFieldDescriptor, RunnerSchema } from '../types'

export type DeriveLogicArgs = {
  schema: RunnerSchema | null
  values: Record<string, unknown>
  /**
   * Hidden-field values. The public transport does not surface hidden values,
   * so callers typically pass `{}`; the evaluator still applies declared
   * `x-om-hidden-fields` defaults on top.
   */
  hidden: Record<string, unknown>
  locale: string
}

/**
 * Compute the reactive `LogicState` for the current answers, mirroring the
 * reactive runner. Returns `null` when there is no schema yet so callers can
 * fall back to role-only visibility.
 */
export function deriveLogicState(args: DeriveLogicArgs): LogicState | null {
  if (!args.schema) return null
  return evaluateFormLogic(args.schema as Record<string, unknown>, {
    answers: args.values,
    hidden: args.hidden,
    locale: args.locale,
  })
}

export type SectionMissingArgs = {
  schema: RunnerSchema | null
  fieldIndex: Record<string, RunnerFieldDescriptor>
  sectionFieldKeys: string[]
  values: Record<string, unknown>
  /**
   * The set of field keys currently visible per `x-om-visibility-if`. When
   * provided, hidden required fields are ignored so they cannot block Next /
   * submit. When `null`, conditional visibility is not applied (role-only).
   */
  visibleFieldKeys: ReadonlySet<string> | null
}

const FALLBACK_DESCRIPTOR_TYPE = 'text'

/**
 * Required-field gating that ignores fields hidden by `x-om-visibility-if`.
 * Pure — shared by the hook's `validateSection` so it stays unit testable.
 */
export function collectMissingRequired(args: SectionMissingArgs): string[] {
  const { schema, fieldIndex, sectionFieldKeys, values, visibleFieldKeys } = args
  if (!schema) return []
  const required = Array.isArray(schema.required) ? schema.required : []
  const requiredSet = new Set(required)
  const missing: string[] = []
  for (const fieldKey of sectionFieldKeys) {
    if (!requiredSet.has(fieldKey)) continue
    // A field hidden by conditional visibility cannot block progression.
    if (visibleFieldKeys && !visibleFieldKeys.has(fieldKey)) continue
    const descriptorType = fieldIndex[fieldKey]?.type ?? FALLBACK_DESCRIPTOR_TYPE
    if (descriptorType === 'info_block') continue
    const value = values[fieldKey]
    if (value === undefined || value === null) {
      missing.push(fieldKey)
      continue
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      missing.push(fieldKey)
      continue
    }
    if (Array.isArray(value) && value.length === 0) {
      missing.push(fieldKey)
      continue
    }
  }
  return missing
}
