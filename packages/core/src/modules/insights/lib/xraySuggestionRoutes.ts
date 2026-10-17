import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { XraySuggestionView } from '../data/validators'
import type { RegisteredProcess } from './process/registry'
import { createXrayDatabase } from './projection/runtime'
import { findSuggestion, type StoredSuggestion } from './suggestions/store'
import type { SuggestionRule } from './suggestions/draft'
import { scopeRequestView } from './routeHelpers'
import {
  XRAY_VIEW_FEATURE,
  findRegisteredProcess,
  resolveXrayAnalyticsAccess,
  xrayProcessFeatures,
  type XrayAnalyticsAccess,
} from './xrayAnalyticsAccess'
import { readRouteParam, xrayErrorResponse, type XrayRouteParams } from './xrayAnalyticsRoutes'
import { resolveXrayActivityLabels } from './xrayActivityLabels'

const triggerSchema = z.object({
  activityKey: z.string().min(1),
  activityKind: z.string().min(1),
  field: z.string().nullable(),
  value: z.string().nullable(),
  eventId: z.string().nullable().optional(),
})

const conditionSchema = z.object({ field: z.string().min(1), value: z.string().min(1) })

const followupSchema = z.object({
  field: z.string().min(1),
  value: z.string().min(1),
  activityKind: z.string().optional(),
  commandId: z.string().nullable().optional(),
})

type FeatureChecker = {
  userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
}

function isFeatureChecker(value: unknown): value is FeatureChecker {
  return Boolean(value) && typeof value === 'object' && typeof (value as { userHasAllFeatures?: unknown }).userHasAllFeatures === 'function'
}

/** The stored rule of a suggestion, or `null` when its stored shape is unusable. */
export function suggestionRuleOf(stored: StoredSuggestion): SuggestionRule | null {
  const trigger = triggerSchema.safeParse(stored.trigger)
  const condition = stored.condition === null ? null : conditionSchema.safeParse(stored.condition)
  const followups = z.array(followupSchema).min(1).safeParse(stored.followups)
  if (!trigger.success || !followups.success || (condition !== null && !condition.success)) return null
  return {
    processKey: stored.processKey,
    signatureHash: stored.signatureHash,
    trigger: {
      activityKey: trigger.data.activityKey,
      activityKind: trigger.data.activityKind,
      field: trigger.data.field,
      value: trigger.data.value,
    },
    condition: condition?.success ? condition.data : null,
    followups: followups.data.map((followup) => ({ field: followup.field, value: followup.value })),
  }
}

/** The API view of a stored suggestion (identifiers, statistics and status; never actors). */
export function toSuggestionView(stored: StoredSuggestion, process: Pick<RegisteredProcess, 'labelKey'> | null): XraySuggestionView {
  const trigger = triggerSchema.safeParse(stored.trigger)
  const condition = stored.condition === null ? null : conditionSchema.safeParse(stored.condition)
  const followups = z.array(followupSchema).safeParse(stored.followups)
  return {
    id: stored.id,
    processKey: stored.processKey,
    processLabelKey: process?.labelKey ?? stored.processKey,
    organizationId: stored.organizationId,
    status: stored.status,
    trigger: trigger.success
      ? { activityKey: trigger.data.activityKey, activityKind: trigger.data.activityKind, field: trigger.data.field, value: trigger.data.value, eventId: trigger.data.eventId ?? null }
      : { activityKey: stored.triggerActivityKey, activityKind: 'unknown', field: null, value: null, eventId: null },
    condition: condition?.success ? condition.data : null,
    followups: followups.success
      ? followups.data.map((followup) => ({ field: followup.field, value: followup.value, activityKind: followup.activityKind ?? 'stage', commandId: followup.commandId ?? null }))
      : [],
    windowSeconds: stored.windowSeconds,
    support: stored.support,
    triggerCount: stored.triggerCount,
    confidence: Math.min(1, Math.max(0, stored.confidence)),
    lift: Math.max(0, stored.lift),
    distinctActorCount: stored.distinctActorCount,
    draftable: stored.draftable,
    notDraftableReason: stored.notDraftableReason,
    draftedArtifactId: stored.draftedArtifactId,
    computedAt: stored.computedAt,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

/** The activity keys a suggestion's rule shows: the trigger and `<field>:<value>` of the condition and follow-ups. */
export function suggestionActivityKeys(view: Pick<XraySuggestionView, 'trigger' | 'condition' | 'followups'>): string[] {
  const keys = [view.trigger.activityKey]
  if (view.condition) keys.push(`${view.condition.field}:${view.condition.value}`)
  for (const followup of view.followups) keys.push(`${followup.field}:${followup.value}`)
  return keys
}

export type XraySuggestionLabelScope = {
  container: AwilixContainer
  userId: string
  translate: TranslateFn
  locale?: string | null
  process: RegisteredProcess
  access: Pick<XrayAnalyticsAccess, 'tenantId' | 'organizationIds' | 'rbacOrganizationId'>
}

/**
 * The views with `activityLabels` of their rules (one label batch for the views of one process,
 * scoped to the caller like the analytics routes). Never throws: unlabelled keys are left out.
 */
export async function withSuggestionLabels(scope: XraySuggestionLabelScope, views: XraySuggestionView[]): Promise<XraySuggestionView[]> {
  if (views.length === 0) return views
  const labels = await resolveXrayActivityLabels(
    {
      container: scope.container,
      process: scope.process,
      tenantId: scope.access.tenantId,
      organizationIds: scope.access.organizationIds,
      rbacOrganizationId: scope.access.rbacOrganizationId,
      userId: scope.userId,
      translate: scope.translate,
      locale: scope.locale ?? null,
    },
    views.flatMap(suggestionActivityKeys),
  )
  return views.map((view) => ({
    ...view,
    activityLabels: Object.fromEntries(
      suggestionActivityKeys(view).flatMap((key) => (Object.prototype.hasOwnProperty.call(labels, key) ? [[key, labels[key]]] : [])),
    ),
  }))
}

export type XraySuggestionRouteContext = {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  translate: TranslateFn
  suggestion: StoredSuggestion
  process: RegisteredProcess
  access: XrayAnalyticsAccess
  rbac: FeatureChecker
}

/** The one 404 body for an unknown, invisible or malformed suggestion id. */
export function xraySuggestionNotFound(translate: TranslateFn): NextResponse {
  return xrayErrorResponse(translate, 'suggestion_not_found', 404)
}

/**
 * Resolves a request about one suggestion: the caller (401 without one; 403 without a resolved
 * tenant), the suggestion in the caller's tenant, its registered process, and access for
 * `features` plus `insights.xray.view` and the process's `requiredFeatures` — the suggestion's
 * organization must be in the resolved organization scope AND every feature must be held there
 * (wildcard-aware `rbacService.userHasAllFeatures` at the suggestion's organization). An unknown,
 * malformed, invisible or out-of-scope id, a process no longer registered and an organization
 * whose settings disable X-Ray all answer the same 404.
 */
export async function prepareXraySuggestionRoute(
  req: Request,
  routeContext: XrayRouteParams,
  features: readonly string[],
): Promise<XraySuggestionRouteContext | NextResponse> {
  const { t: translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.sub) return xrayErrorResponse(translate, 'unauthorized', 401)
  const container = (await createRequestContainer()) as AwilixContainer
  const tenantAccess = await resolveXrayAnalyticsAccess({ container, auth, request: scopeRequestView(req), requiredFeatures: [XRAY_VIEW_FEATURE] })
  if (!tenantAccess) return xrayErrorResponse(translate, 'tenant_required', 403)
  const id = await readRouteParam(routeContext, 'id')
  if (!id || !z.string().uuid().safeParse(id).success) return xraySuggestionNotFound(translate)
  const em = (container.resolve('em') as EntityManager).fork()
  const suggestion = await findSuggestion(createXrayDatabase(em), tenantAccess.tenantId, id.toLowerCase())
  if (!suggestion) return xraySuggestionNotFound(translate)
  const process = findRegisteredProcess(suggestion.processKey)
  if (!process) return xraySuggestionNotFound(translate)
  const requiredFeatures = Array.from(new Set([...features, ...xrayProcessFeatures(process)]))
  const access = await resolveXrayAnalyticsAccess({ container, auth, request: scopeRequestView(req), requiredFeatures })
  if (!access || !access.visible || access.tenantId !== suggestion.tenantId.toLowerCase()) return xraySuggestionNotFound(translate)
  const organizationId = suggestion.organizationId.toLowerCase()
  if (access.organizationIds !== null && !access.organizationIds.includes(organizationId)) return xraySuggestionNotFound(translate)
  let rbac: unknown = null
  try {
    rbac = container.resolve('rbacService')
  } catch {
    rbac = null
  }
  if (!isFeatureChecker(rbac)) return xraySuggestionNotFound(translate)
  const heldThere = await rbac.userHasAllFeatures(auth.sub, requiredFeatures, { tenantId: access.tenantId, organizationId })
  if (!heldThere) return xraySuggestionNotFound(translate)
  return { container, auth, translate, suggestion, process, access, rbac }
}
