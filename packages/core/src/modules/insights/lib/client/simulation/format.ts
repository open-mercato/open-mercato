import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { simulationKindModule } from './api'
import type { SimulationRequestError } from './types'

/** Route error codes with a translated message (`insights.simulation.errors.<code>`). */
export const SIMULATION_KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  'artifact_not_found',
  'decision_exists',
  'forbidden',
  'internal_error',
  'invalid_proposal',
  'invalid_request',
  'invalid_window',
  'not_customized',
  'organization_scope_required',
  'proposal_too_large',
  'rate_limit_unavailable',
  'rate_limited',
  'run_not_active',
  'run_not_completed',
  'run_not_found',
  'simulation_busy',
  'unauthorized',
  'unsupported_event_payload',
  'unsupported_kind',
])

/** Codes a run stores when it failed or was cancelled by the system (`insights.simulation.errorCodes.<code>`). */
export const SIMULATION_RUN_ERROR_CODES: ReadonlySet<string> = new Set([
  'forbidden',
  'kind_unavailable',
  'statement_timeout',
  'decryption_unavailable',
  'abandoned',
  'internal',
])

export const SIMULATION_FIDELITY_VALUES = ['observed', 'reconstructed', 'mixed', 'none'] as const

export type SimulationFidelityValue = (typeof SIMULATION_FIDELITY_VALUES)[number]

export function readSimulationFidelity(value: string | null | undefined): SimulationFidelityValue | null {
  return SIMULATION_FIDELITY_VALUES.find((fidelity) => fidelity === value) ?? null
}

/** The translated message of a failed simulation call: the code's own text, else the route's translated text. */
export function describeSimulationError(
  error: SimulationRequestError | null | undefined,
  t: TranslateFn,
  fallbackKey = 'insights.simulation.ui.errors.loadFailed',
): string {
  if (error?.code && SIMULATION_KNOWN_ERROR_CODES.has(error.code)) return t(`insights.simulation.errors.${error.code}`)
  if (error?.httpStatus === 403) return t('insights.simulation.errors.forbidden')
  if (error?.message) return error.message
  return t(fallbackKey)
}

export function isSimulationNotFound(error: SimulationRequestError | null | undefined): boolean {
  return error?.code === 'run_not_found' || error?.httpStatus === 404
}

/** Why a run ended without a result (`errorCode` of a failed or cancelled run). */
export function describeSimulationRunError(errorCode: string | null | undefined, t: TranslateFn): string | null {
  if (!errorCode) return null
  if (SIMULATION_RUN_ERROR_CODES.has(errorCode)) return t(`insights.simulation.errorCodes.${errorCode}`)
  return t('insights.simulation.errorCodes.internal')
}

export function simulationKindLabel(kind: string, labelKey: string | null | undefined, t: TranslateFn): string {
  return labelKey ? t(labelKey, kind) : kind
}

/** An outcome label of a kind's cell: `<module>.simulation.cells.<cell>`, else the raw key. */
export function simulationCellLabel(kind: string, cellKey: string, t: TranslateFn): string {
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.cells.${cellKey}`, cellKey) : cellKey
}

/** A result flag of a kind: `<module>.simulation.flags.<flag>`, else the raw flag. */
export function simulationFlagLabel(kind: string, flag: string, t: TranslateFn): string {
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.flags.${flag}`, flag) : flag
}

export function simulationGroupLabel(groupKey: string, labelKey: string | null | undefined, t: TranslateFn): string {
  return labelKey ? t(labelKey, groupKey) : groupKey
}

export function simulationCoverageLabel(key: string, t: TranslateFn): string {
  return t(`insights.simulation.coverage.${key}`, key)
}

/** An i18n key carried by a result (warnings, caveats); unknown keys stay readable as the raw key. */
export function translateSimulationKey(key: string, t: TranslateFn): string {
  return t(key, key)
}
