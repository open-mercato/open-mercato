import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ExplainLoadContext } from '@open-mercato/shared/modules/insights/explain'
import { PROCESS_NONE_VALUE, PROCESS_OTHER_VALUE } from '@open-mercato/shared/modules/insights/process'
import { XRAY_MAP_END, XRAY_MAP_START } from './analytics/types'
import { resolveReferenceDetails } from './causes'
import type { RegisteredProcess, RegisteredProcessField, RegisteredProcessMilestone } from './process/registry'
import type { ExplainFeatureChecker } from './viewer'

const logger = createLogger('insights').child({ component: 'xray-activity-labels' })

/** At most this many distinct keys are labelled per call (every analytics result is bounded far below). */
export const XRAY_ACTIVITY_LABELS_MAX_KEYS = 2000

const LABEL_MAX_LENGTH = 200

const SHORT_ID_LENGTH = 8

/** Activity key → human-readable label (translated declaration labels and resolved values). */
export type XrayActivityLabels = Record<string, string>

type LifecycleActivity = 'created' | 'deleted'

export type ParsedXrayActivity =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'lifecycle'; activity: LifecycleActivity }
  | { kind: 'exit'; labelKey: string; key: string }
  | { kind: 'fieldChanged'; field: RegisteredProcessField }
  | { kind: 'fieldValue'; field: RegisteredProcessField; value: string; milestone: RegisteredProcessMilestone | null }
  | { kind: 'milestoneLifecycle'; milestone: RegisteredProcessMilestone; activity: LifecycleActivity }

/** Who asks and where: reference labels are resolved only within this tenant and organization scope. */
export type XrayActivityLabelContext = {
  container: Pick<AwilixContainer, 'resolve'>
  process: RegisteredProcess
  tenantId: string
  organizationIds: string[] | null
  rbacOrganizationId: string | null
  userId: string
  translate: TranslateFn
  locale?: string | null
}

type FeatureRbac = {
  userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
}

function isLifecycleActivity(value: string): value is LifecycleActivity {
  return value === 'created' || value === 'deleted'
}

/**
 * The declaration element an activity key of `process` was derived from (see
 * `lib/process/activities.ts`): the map's start / end, `created` / `deleted`, an exit key,
 * `<field>:<value>` of a stage field, `<field>:changed` of a follow-up field,
 * `<milestone>.created|deleted` and `<milestone>.<field>:<value>`. `null` for anything else
 * (e.g. a key of a field no longer declared).
 */
export function parseXrayActivityKey(process: RegisteredProcess, key: string): ParsedXrayActivity | null {
  if (key === XRAY_MAP_START) return { kind: 'start' }
  if (key === XRAY_MAP_END) return { kind: 'end' }
  if (isLifecycleActivity(key)) return { kind: 'lifecycle', activity: key }
  const exit = process.exits.find((candidate) => candidate.key === key)
  if (exit) return { kind: 'exit', labelKey: exit.labelKey, key: exit.key }
  const separator = key.indexOf(':')
  if (separator < 0) {
    const dot = key.indexOf('.')
    if (dot <= 0) return null
    const milestone = process.milestones.find((candidate) => candidate.key === key.slice(0, dot))
    const activity = key.slice(dot + 1)
    if (!milestone || !isLifecycleActivity(activity) || !milestone.lifecycle.includes(activity)) return null
    return { kind: 'milestoneLifecycle', milestone, activity }
  }
  const prefix = key.slice(0, separator)
  const value = key.slice(separator + 1)
  if (value.length === 0) return null
  const dot = prefix.indexOf('.')
  if (dot > 0) {
    const milestone = process.milestones.find((candidate) => candidate.key === prefix.slice(0, dot))
    const field = milestone?.fields.find((candidate) => candidate.key === prefix.slice(dot + 1))
    return milestone && field ? { kind: 'fieldValue', field, value, milestone } : null
  }
  const stageField = process.stageFields.find((candidate) => candidate.key === prefix)
  if (stageField) return { kind: 'fieldValue', field: stageField, value, milestone: null }
  const followupField = process.followupFields.find((candidate) => candidate.key === prefix)
  if (followupField && value === 'changed') return { kind: 'fieldChanged', field: followupField }
  return null
}

function boundLabel(label: string): string {
  const trimmed = label.trim()
  return trimmed.length > LABEL_MAX_LENGTH ? `${trimmed.slice(0, LABEL_MAX_LENGTH - 1)}…` : trimmed
}

function translateOr(translate: TranslateFn, key: string, fallback: string): string {
  const translated = translate(key, fallback)
  return translated.trim().length > 0 ? translated : fallback
}

type ReferenceLabels = ReadonlyMap<string, ReadonlyMap<string, string>>

function isReservedValue(value: string): boolean {
  return value === PROCESS_NONE_VALUE || value === PROCESS_OTHER_VALUE
}

function declaredValueLabel(field: RegisteredProcessField, value: string, translate: TranslateFn): string | null {
  const labels = field.valueLabelKeys
  const labelKey = labels && Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : null
  if (!labelKey) return null
  const translated = translate(labelKey, '')
  return translated.trim().length > 0 && translated !== labelKey ? translated : null
}

function valueLabel(field: RegisteredProcessField, value: string, translate: TranslateFn, references: ReferenceLabels): string {
  if (value === PROCESS_NONE_VALUE) return translate('insights.xray.ui.activity.noneValue')
  if (value === PROCESS_OTHER_VALUE) return translate('insights.xray.ui.activity.otherValue')
  const declared = declaredValueLabel(field, value, translate)
  if (declared) return declared
  const referenced = field.referenceKind ? references.get(field.referenceKind)?.get(value) : undefined
  if (referenced) return referenced
  if (isUuid(value)) return translate('insights.xray.ui.activity.unknownReference', { id: value.slice(0, SHORT_ID_LENGTH) })
  return value
}

function fieldLabel(field: RegisteredProcessField, translate: TranslateFn): string {
  return translateOr(translate, field.labelKey, field.key)
}

/** The label of one parsed activity (pure; reference labels resolved beforehand). */
export function formatXrayActivity(activity: ParsedXrayActivity, translate: TranslateFn, references: ReferenceLabels = new Map()): string {
  switch (activity.kind) {
    case 'start':
      return translate('insights.xray.ui.activity.start')
    case 'end':
      return translate('insights.xray.ui.activity.end')
    case 'lifecycle':
      return translate(`insights.xray.ui.activity.${activity.activity}`)
    case 'exit':
      return translateOr(translate, activity.labelKey, activity.key)
    case 'fieldChanged':
      return translate('insights.xray.ui.activity.fieldChanged', { field: fieldLabel(activity.field, translate) })
    case 'milestoneLifecycle':
      return translate(
        activity.activity === 'created' ? 'insights.xray.ui.activity.milestoneCreated' : 'insights.xray.ui.activity.milestoneDeleted',
        { milestone: translateOr(translate, activity.milestone.labelKey, activity.milestone.key) },
      )
    case 'fieldValue': {
      const field = fieldLabel(activity.field, translate)
      const value = valueLabel(activity.field, activity.value, translate, references)
      if (!activity.milestone) return translate('insights.xray.ui.activity.fieldValue', { field, value })
      return translate('insights.xray.ui.activity.milestoneFieldValue', {
        milestone: translateOr(translate, activity.milestone.labelKey, activity.milestone.key),
        field,
        value,
      })
    }
  }
}

function isFeatureRbac(value: unknown): value is FeatureRbac {
  return Boolean(value) && typeof value === 'object' && typeof (value as { userHasAllFeatures?: unknown }).userHasAllFeatures === 'function'
}

/** Wildcard-aware RBAC at the caller's feature-check organization, memoized per feature set; fails closed. */
function createLabelFeatureChecker(rbac: FeatureRbac, context: XrayActivityLabelContext): ExplainFeatureChecker {
  const cache = new Map<string, Promise<boolean>>()
  const has = (requiredFeatures: readonly string[] | undefined): Promise<boolean> => {
    const features = Array.from(new Set((requiredFeatures ?? []).filter((feature) => typeof feature === 'string' && feature.length > 0)))
    if (features.length === 0) return Promise.resolve(false)
    const key = features.join('\u0000')
    const cached = cache.get(key)
    if (cached) return cached
    const pending = rbac.userHasAllFeatures(context.userId, features, { tenantId: context.tenantId, organizationId: context.rbacOrganizationId })
    cache.set(key, pending)
    return pending
  }
  return {
    organizationId: context.rbacOrganizationId,
    has,
    prepare: async () => () => false,
  }
}

function collectReferenceRequests(activities: Iterable<ParsedXrayActivity>, translate: TranslateFn): Map<string, Set<string>> {
  const requests = new Map<string, Set<string>>()
  for (const activity of activities) {
    if (activity.kind !== 'fieldValue' || !activity.field.referenceKind) continue
    if (isReservedValue(activity.value) || declaredValueLabel(activity.field, activity.value, translate)) continue
    const values = requests.get(activity.field.referenceKind) ?? new Set<string>()
    values.add(activity.value)
    requests.set(activity.field.referenceKind, values)
  }
  return requests
}

function reportLabelFailure(error: unknown, processKey: string): void {
  logger.warn('[internal] X-Ray activity labels fell back to declared labels', { processKey, err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_labels_failed', attributes: { processKey } })
}

/**
 * Labels of stored values through the reference resolvers the fields declare
 * (`referenceKind`): one call per kind, only when the caller holds the resolver's
 * `requiredFeatures` at their feature-check organization, with the load context and every
 * returned detail limited to the caller's tenant and organization scope. Never throws: a
 * missing service, a denied feature or a failing resolver leaves the values unresolved.
 */
async function resolveReferenceLabels(context: XrayActivityLabelContext, requests: Map<string, Set<string>>): Promise<ReferenceLabels> {
  const resolved = new Map<string, Map<string, string>>()
  if (requests.size === 0) return resolved
  try {
    const rbac = context.container.resolve('rbacService')
    if (!isFeatureRbac(rbac)) return resolved
    const em = (context.container.resolve('em') as EntityManager).fork()
    const checker = createLabelFeatureChecker(rbac, context)
    const loadContext: ExplainLoadContext = {
      em,
      resolve: <TService>(name: string): TService | undefined => {
        try {
          return context.container.resolve(name) as TService
        } catch {
          return undefined
        }
      },
      scope: { tenantId: context.tenantId, organizationIds: context.organizationIds },
      userId: isUuid(context.userId) ? context.userId : null,
      locale: context.locale ?? null,
    }
    const detailScope = { viewerOrganizationIds: context.organizationIds, recordOrganizationId: null }
    for (const [kind, values] of requests) {
      const index = await resolveReferenceDetails({ kind, values: Array.from(values), checker, loadContext, detailScope })
      const labels = new Map<string, string>()
      for (const value of values) {
        const label = index.get(value)?.label
        if (typeof label === 'string' && label.trim().length > 0) labels.set(value, boundLabel(label))
      }
      resolved.set(kind, labels)
    }
  } catch (error) {
    reportLabelFailure(error, context.process.processKey)
  }
  return resolved
}

/**
 * Human-readable labels of activity keys of one process, resolved on the server: declared
 * field / milestone / exit labels (translated), `none` / `other` as translated "not set" /
 * "other value", declared value labels, and dictionary or record labels through the declared
 * reference resolvers (feature-checked, tenant- and organization-scoped, batched; an
 * unresolved record id gets a short "unknown" label). Keys that do not belong to the process
 * are left out, so callers keep a client-side fallback. Callers pass only keys the response
 * already discloses (never a suppressed cell).
 */
export async function resolveXrayActivityLabels(context: XrayActivityLabelContext, keys: Iterable<string>): Promise<XrayActivityLabels> {
  const parsed = new Map<string, ParsedXrayActivity>()
  for (const key of keys) {
    if (parsed.size >= XRAY_ACTIVITY_LABELS_MAX_KEYS) break
    if (typeof key !== 'string' || parsed.has(key)) continue
    const activity = parseXrayActivityKey(context.process, key)
    if (activity) parsed.set(key, activity)
  }
  if (parsed.size === 0) return {}
  const references = await resolveReferenceLabels(context, collectReferenceRequests(parsed.values(), context.translate))
  return Object.fromEntries(
    Array.from(parsed.entries()).map(([key, activity]) => [key, boundLabel(formatXrayActivity(activity, context.translate, references))]),
  )
}
