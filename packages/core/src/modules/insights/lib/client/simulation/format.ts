import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { shortId } from '../xray/format'
import { ROLE_ACL_PREVIEW_SIMULATION_KIND, TRIGGER_BACKTEST_SIMULATION_KIND, simulationKindModule } from './api'
import { PRICE_BACKTEST_SIMULATION_KIND, describePriceBacktestGroup } from './priceBacktest'
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
  if (kind === PRICE_BACKTEST_SIMULATION_KIND) {
    const described = describePriceBacktestGroup(group.key)
    const family = group.labelKey ? t(group.labelKey, described.family) : described.family
    if (!described.currencyCode || !described.basis) return { title: family, subtitle: null }
    const moduleId = simulationKindModule(kind)
    return {
      title: t('insights.simulation.ui.result.priceGroupTitle', { family, currency: described.currencyCode }),
      subtitle: moduleId ? t(`${moduleId}.simulation.basis.${described.basis}`, described.basis) : described.basis,
    }
  }
  return { title: simulationGroupLabel(group.key, group.labelKey, t), subtitle: group.labelKey ? group.key : null }
}

/**
 * A result wording the kind's owning module may override (`<module>.simulation.<key>`: a price
 * backtest counts lines, a permission preview users and API keys), else the generic insights text
 * `fallbackKey` (worded for events). Every kind-specific heading, total and note goes through here.
 */
export function simulationKindText(kind: string, key: string, fallbackKey: string, t: TranslateFn, params?: Record<string, string | number>): string {
  const fallback = params ? t(fallbackKey, params) : t(fallbackKey)
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.${key}`, fallback, params) : fallback
}

/** A group's total: `<module>.simulation.groupTotal`, else "{count} events". */
export function simulationGroupTotalLabel(kind: string, count: string, t: TranslateFn): string {
  return simulationKindText(kind, 'groupTotal', 'insights.simulation.ui.result.eventsTotal', t, { count })
}

/** A suppressed group's note: `<module>.simulation.groupSuppressed`, else "Fewer than {k} events — hidden". */
export function simulationGroupSuppressedLabel(kind: string, k: string, t: TranslateFn): string {
  return simulationKindText(kind, 'groupSuppressed', 'insights.simulation.ui.result.groupSuppressed', t, { k })
}

/** The result heading and privacy note: `<module>.simulation.result.title` / `.privacyNote`, else the generic ones. */
export function simulationResultHeading(kind: string, k: string, t: TranslateFn): { title: string; privacyNote: string } {
  return {
    title: simulationKindText(kind, 'result.title', 'insights.simulation.ui.result.title', t),
    privacyNote: simulationKindText(kind, 'result.privacyNote', 'insights.simulation.ui.result.privacyNote', t, { k }),
  }
}

/** The empty state of a completed run without groups: `<module>.simulation.result.emptyTitle` / `.emptyDescription`, else the generic ones. */
export function simulationEmptyResult(kind: string, t: TranslateFn): { title: string; description: string } {
  return {
    title: simulationKindText(kind, 'result.emptyTitle', 'insights.simulation.ui.result.emptyTitle', t),
    description: simulationKindText(kind, 'result.emptyDescription', 'insights.simulation.ui.result.emptyDescription', t),
  }
}

/** The fidelity note of a queued run's result: `<module>.simulation.fidelity.<value>`, else the generic one. */
export function simulationFidelityText(kind: string, fidelity: SimulationFidelityValue, t: TranslateFn): string {
  return simulationKindText(kind, `fidelity.${fidelity}`, `insights.simulation.ui.fidelity.${fidelity}`, t)
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

function translateIfPresent(key: string, t: TranslateFn): string | null {
  const value = t(key)
  return value === key ? null : value
}

/**
 * A coverage count's label: the kind module's own label (`<module>.simulation.coverage.<key>`), else
 * the generic one (`insights.simulation.coverage.<key>`); a `<group prefix>_<item>` key of a kind
 * whose groups are keyed `<group prefix>:…` (e.g. `orders_lines_scanned` of a price backtest) is
 * labelled "<group label>: <item label>". Unknown keys stay readable as the raw key.
 */
export function simulationCoverageLabel(
  key: string,
  t: TranslateFn,
  context?: { kind?: string | null; groups?: ReadonlyArray<{ key: string; labelKey?: string | null }> },
): string {
  const moduleId = context?.kind ? simulationKindModule(context.kind) : null
  const own = moduleId ? translateIfPresent(`${moduleId}.simulation.coverage.${key}`, t) : null
  if (own) return own
  const generic = translateIfPresent(`insights.simulation.coverage.${key}`, t)
  if (generic) return generic
  if (moduleId) {
    for (const group of context?.groups ?? []) {
      const prefix = group.key.split(':')[0]
      if (!prefix || !group.labelKey || !key.startsWith(`${prefix}_`)) continue
      const item = translateIfPresent(`${moduleId}.simulation.coverage.${key.slice(prefix.length + 1)}`, t)
      if (item) return t('insights.simulation.ui.coverage.familyItem', { family: t(group.labelKey, prefix), item })
    }
  }
  return key
}

/** A measure label of a kind: `<module>.simulation.measures.<key>`, else the raw key. */
export function simulationMeasureLabel(kind: string, measureKey: string, t: TranslateFn): string {
  const moduleId = simulationKindModule(kind)
  return moduleId ? t(`${moduleId}.simulation.measures.${measureKey}`, measureKey) : measureKey
}

/**
 * A measure value in the viewer's locale: a money amount in its own currency (never converted), a
 * plain decimal otherwise; a `…_delta` measure shows its sign. Falls back to the stored text.
 */
export function formatSimulationMeasure(measure: { key: string; value: string; currencyCode: string | null }, locale: string): string {
  const amount = Number(measure.value)
  if (!Number.isFinite(amount)) return measure.value
  const signDisplay = measure.key.endsWith('_delta') ? 'exceptZero' : 'auto'
  try {
    return new Intl.NumberFormat(locale, measure.currencyCode
      ? { style: 'currency', currency: measure.currencyCode, minimumFractionDigits: 2, maximumFractionDigits: 4, signDisplay }
      : { minimumFractionDigits: 2, maximumFractionDigits: 4, signDisplay }).format(amount)
  } catch {
    return measure.value
  }
}

/** An i18n key carried by a result (warnings, caveats); unknown keys stay readable as the raw key. */
export function translateSimulationKey(key: string, t: TranslateFn): string {
  return t(key, key)
}
