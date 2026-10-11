import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { shortId } from '../xray/format'
import { ROLE_ACL_PREVIEW_SIMULATION_KIND, TRIGGER_BACKTEST_SIMULATION_KIND, simulationKindModule } from './api'
import { describeRoleAclGroup } from './roleAclPreview'
import { describeTriggerBacktestGroup } from './triggerBacktest'
import type { SimulationRequestError } from './types'

/** Route error codes with a translated message (`insights.simulation.errors.<code>`). */
export const SIMULATION_KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  'access_log_unavailable',
  'artifact_not_found',
  'artifact_unavailable',
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

export type SimulationGroupHeading = {
  title: string
  subtitle: string | null
}

/**
 * The heading of a result group: the group label with its raw key underneath when the label is
 * translated; for a trigger backtest the event and the trigger (name from the run's own proposal,
 * and the pattern it listens to); for a role permission preview the organization (its name from
 * `groupLabels`, resolved live) and the principal type.
 */
export function simulationGroupHeading(
  kind: string,
  group: { key: string; labelKey?: string | null },
  proposal: unknown,
  t: TranslateFn,
  groupLabels?: Record<string, string> | null,
): SimulationGroupHeading {
  if (kind === ROLE_ACL_PREVIEW_SIMULATION_KIND) {
    const described = describeRoleAclGroup(group.key)
    const organizationName = groupLabels?.[group.key] ?? null
    const title = organizationName
      ?? (described.organizationId
        ? t('insights.simulation.ui.result.organizationGroupTitle', { id: shortId(described.organizationId) })
        : group.key)
    return { title, subtitle: group.labelKey ? t(group.labelKey, group.key) : null }
  }
  if (kind === TRIGGER_BACKTEST_SIMULATION_KIND) {
    const described = describeTriggerBacktestGroup(group.key, proposal)
    const name = described.name ?? described.triggerId
    if (described.eventId) {
      return {
        title: described.eventId,
        subtitle: t('insights.simulation.ui.result.triggerGroupSubtitle', { name, pattern: described.eventPattern ?? '' }),
      }
    }
    return { title: t('insights.simulation.ui.result.triggerGroupTitle', { name }), subtitle: described.eventPattern }
  }
  return { title: simulationGroupLabel(group.key, group.labelKey, t), subtitle: group.labelKey ? group.key : null }
}

/** "{count} events", or the owning module's own wording (`<module>.simulation.groupTotal`). */
export function simulationGroupTotalLabel(kind: string, count: string, t: TranslateFn): string {
  const fallback = t('insights.simulation.ui.result.eventsTotal', { count })
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.groupTotal`, fallback, { count }) : fallback
}

/** "Fewer than {k} events — hidden", or the owning module's wording (`<module>.simulation.groupSuppressed`). */
export function simulationGroupSuppressedLabel(kind: string, k: string, t: TranslateFn): string {
  const fallback = t('insights.simulation.ui.result.groupSuppressed', { k })
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.groupSuppressed`, fallback, { k }) : fallback
}

/** A label of a result-summary count or list: `<module>.simulation.summary.<key>`, else the raw key. */
export function simulationSummaryLabel(kind: string, key: string, t: TranslateFn): string {
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.summary.${key}`, key) : key
}

/** A live record's type: `<module>.simulation.records.types.<type>`, else the raw type. */
export function simulationRecordTypeLabel(kind: string, type: string, t: TranslateFn): string {
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.records.types.${type}`, type) : type
}

/** A live record's count column: `<module>.simulation.records.counts.<key>`, else the raw key. */
export function simulationRecordCountLabel(kind: string, key: string, t: TranslateFn): string {
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.records.counts.${key}`, key) : key
}

/** The empty state of a completed run without groups: the owning module's wording, else the generic one. */
/** The result heading and privacy note, or the owning module's wording (`<module>.simulation.result.title` / `.privacyNote`). */
export function simulationResultHeading(kind: string, k: string, t: TranslateFn): { title: string; privacyNote: string } {
  const title = t('insights.simulation.ui.result.title')
  const privacyNote = t('insights.simulation.ui.result.privacyNote', { k })
  const moduleId = simulationKindModule(kind)
  if (!moduleId) return { title, privacyNote }
  return {
    title: t(`${moduleId}.simulation.result.title`, title),
    privacyNote: t(`${moduleId}.simulation.result.privacyNote`, privacyNote, { k }),
  }
}

export function simulationEmptyResult(kind: string, t: TranslateFn): { title: string; description: string } {
  const moduleId = simulationKindModule(kind)
  const title = t('insights.simulation.ui.result.emptyTitle')
  const description = t('insights.simulation.ui.result.emptyDescription')
  if (!moduleId) return { title, description }
  return {
    title: t(`${moduleId}.simulation.result.emptyTitle`, title),
    description: t(`${moduleId}.simulation.result.emptyDescription`, description),
  }
}

export function simulationCoverageLabel(key: string, t: TranslateFn): string {
  return t(`insights.simulation.coverage.${key}`, key)
}

/** An i18n key carried by a result (warnings, caveats); unknown keys stay readable as the raw key. */
export function translateSimulationKey(key: string, t: TranslateFn): string {
  return t(key, key)
}
