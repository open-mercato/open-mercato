import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  ExplainFieldDescriptor,
  ExplainLoadContext,
  ExplainProviderFact,
  ExplainResolveService,
  ExplainResourceDescriptor,
} from '@open-mercato/shared/modules/insights/explain'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { ActionLogFieldHistoryEntry } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import {
  decodeExplainCursor,
  encodeExplainCursor,
  type ExplainDescriptorsResponse,
  type ExplainFieldResponse,
  type ExplainHintView,
  type ExplainLogResponse,
  type ExplainOverviewResponse,
  type ExplainQuery,
} from '../data/validators'
import {
  buildDependencyResolver,
  collectExternalCausedByLogIds,
  deriveEntryCause,
  explainField,
  hasCollectionItem,
  listOverviewTargets,
  needsChildHistory,
  readCurrentValue,
  readCustomFieldKeys,
  readableDependencyKeys,
  resolveFieldTarget,
  toResponseValue,
  type EngineCause,
  type EngineChainEntry,
  type EngineDependency,
  type EngineHistoryEntry,
  type FeatureGate,
  type FieldTarget,
  type TargetResolutionError,
} from '../lib/engine'
import {
  findExplainResourceByLogKind,
  getExplainProvider,
  getExplainResource,
  listExplainResources,
  type RegisteredExplainResource,
} from '../lib/explain-registry'
import {
  EMPTY_REFERENCE_INDEX,
  LOG_CAUSE_KINDS,
  PRINCIPAL_CAUSE_KINDS,
  resolveCauseDetails,
  resolveReferenceDetails,
  resolveReferenceKindDetails,
  type CauseReference,
  type ExplainDetailScope,
} from '../lib/causes'
import {
  canSeeEntryValues,
  presentActor,
  presentCause,
  presentCausedBy,
  presentChainEntry,
  presentPrincipal,
  presentViewer,
  singleEntryConfidence,
  type ActorKind,
  type PresenterContext,
} from '../lib/presenter'
import { resolveExplainScanMax, scanResourceHistory } from '../lib/scan'
import {
  EXPLAIN_VIEW_FEATURE,
  createExplainFeatureChecker,
  isOrganizationInScope,
  resolveExplainVisibility,
  type ExplainFeatureChecker,
  type ExplainViewer,
  type ExplainViewerRescope,
  type ExplainVisibility,
} from '../lib/viewer'

const logger = createLogger('insights').child({ component: 'explain-service' })

export const EXPLAIN_NOT_FOUND_BODY = { error: 'not_found' } as const

export type ExplainErrorCode = 'not_found' | TargetResolutionError

export type ExplainOutcome<TBody> =
  | { ok: true; body: TBody }
  | { ok: false; status: 400 | 404; body: { error: ExplainErrorCode } }

export type ExplainServiceDeps = {
  em: EntityManager
  rbacService: RbacService
  actionLogService: ActionLogService
  resolve?: ExplainResolveService
  now?: () => Date
  scanMax?: number
}

function notFound<TBody>(): ExplainOutcome<TBody> {
  return { ok: false, status: 404, body: { error: 'not_found' } }
}

function badRequest<TBody>(error: TargetResolutionError): ExplainOutcome<TBody> {
  return { ok: false, status: 400, body: { error } }
}

function readScopeColumn(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function uniqueStrings(values: Iterable<string | null | undefined>): string[] {
  const result = new Set<string>()
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) result.add(value)
  }
  return Array.from(result)
}

function collectResourceFeatureLists(resource: ExplainResourceDescriptor): Array<readonly string[] | undefined> {
  const lists: Array<readonly string[] | undefined> = []
  for (const field of resource.fields) lists.push(field.requiredFeatures)
  for (const collection of resource.collections ?? []) {
    lists.push(collection.requiredFeatures)
    for (const field of collection.fields) lists.push(field.requiredFeatures)
  }
  if (resource.customFields) lists.push(resource.customFields.requiredFeatures)
  return lists
}

function resolveLogResourceKinds(resource: ExplainResourceDescriptor): string[] {
  const declared = uniqueStrings(resource.logResourceKinds ?? [])
  return declared.length > 0 ? declared : [resource.resourceKind]
}

function findTargetDescriptor(resource: ExplainResourceDescriptor, target: FieldTarget): ExplainFieldDescriptor | null {
  if (target.customFieldKey) return null
  if (target.collection) {
    const collection = (resource.collections ?? []).find((candidate) => candidate.key === target.collection?.key)
    const fieldKey = target.key.slice(target.collection.key.length + 1)
    return collection?.fields.find((field) => field.key === fieldKey) ?? null
  }
  return resource.fields.find((field) => field.key === target.key) ?? null
}

function causeReferences(cause: EngineCause): CauseReference[] {
  return [
    { kind: cause.kind, id: cause.id },
    ...cause.frames.map((frame) => ({ kind: frame.kind, id: frame.id ?? null })),
  ]
}

function principalIds(cause: EngineCause): string[] {
  const ids: string[] = []
  if (PRINCIPAL_CAUSE_KINDS.has(cause.kind) && cause.id) ids.push(cause.id)
  for (const frame of cause.frames) {
    if (PRINCIPAL_CAUSE_KINDS.has(frame.kind) && frame.id) ids.push(frame.id)
  }
  return ids
}

function logCauseIds(cause: EngineCause): string[] {
  const ids: string[] = []
  if (LOG_CAUSE_KINDS.has(cause.kind) && cause.id) ids.push(cause.id)
  for (const frame of cause.frames) {
    if (LOG_CAUSE_KINDS.has(frame.kind) && frame.id) ids.push(frame.id)
  }
  return ids
}

function sanitizeHintParams(params: ExplainProviderFact['params']): ExplainHintView['params'] {
  const result: ExplainHintView['params'] = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    }
  }
  return result
}

function presentDependencies(dependencies: EngineDependency[]): ExplainFieldResponse['dependencies'] {
  return dependencies.map((dependency) => ({
    field: dependency.field,
    labelKey: dependency.labelKey,
    verdict: dependency.verdict,
    confidence: dependency.confidence,
    lastChangeAt: dependency.lastChangeAt,
    dependencies: presentDependencies(dependency.dependencies),
  }))
}

type LogReferenceState = {
  visibleLogIds: Set<string>
  unresolvedLogIds: Set<string>
}

type LoadedRecord = {
  current: Record<string, unknown>
  organizationId: string | null
  recordId: string
}

export type ExplainLogOptions = {
  rescope?: ExplainViewerRescope
}

function normalizeRecordId(id: string): string {
  return isUuid(id) ? id.toLowerCase() : id
}

function readRecordId(record: Record<string, unknown>): string | null {
  const raw = record.id
  if (typeof raw === 'string' && raw.length > 0) return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return null
}

export class ExplainService {
  private readonly now: () => Date
  private readonly scanMax: number

  constructor(private readonly deps: ExplainServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.scanMax = deps.scanMax ?? resolveExplainScanMax()
  }

  private buildLoadContext(viewer: ExplainViewer): ExplainLoadContext {
    const resolve = this.deps.resolve
    return {
      em: this.deps.em,
      resolve: <TService>(name: string): TService | undefined => (resolve ? resolve<TService>(name) : undefined),
      scope: { tenantId: viewer.tenantId, organizationIds: viewer.organizationIds },
      userId: viewer.subject.kind === 'user' ? viewer.subject.storageId : null,
      locale: viewer.locale,
    }
  }

  /**
   * Loads the record through the owning module and re-checks tenant and organization
   * scope. A loader failure is logged here and rethrown; the route boundary reports it
   * once.
   */
  private async loadCurrent(
    registered: RegisteredExplainResource,
    loadContext: ExplainLoadContext,
    viewer: ExplainViewer,
    resourceId: string,
  ): Promise<LoadedRecord | null> {
    let current: Record<string, unknown> | null
    try {
      current = await registered.descriptor.loadCurrent(loadContext, resourceId)
    } catch (error) {
      logger.error('[internal] Explain loadCurrent failed', {
        resourceKind: registered.descriptor.resourceKind,
        moduleId: registered.moduleId,
        err: error,
      })
      throw error
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    const tenantId = readScopeColumn(current, 'tenantId', 'tenant_id')
    if (tenantId && tenantId !== viewer.tenantId) return null
    const organizationId = readScopeColumn(current, 'organizationId', 'organization_id')
    if (organizationId && !isOrganizationInScope(organizationId, viewer.organizationIds)) return null
    const loadedId = readRecordId(current)
    if (loadedId !== null && loadedId.toLowerCase() !== resourceId.toLowerCase()) return null
    return { current, organizationId, recordId: normalizeRecordId(loadedId ?? resourceId) }
  }

  /**
   * A referenced log the viewer cannot see (missing, or in another organization) is
   * reported identically as unresolved, so its existence is never revealed.
   */
  private async resolveLogReferences(
    viewer: ExplainViewer,
    history: readonly EngineHistoryEntry[],
    extraLogIds: readonly string[],
  ): Promise<LogReferenceState> {
    const historyIds = new Set(history.map((entry) => entry.logId))
    const causedByIds = collectExternalCausedByLogIds(history)
    const lookupIds = uniqueStrings([...causedByIds, ...extraLogIds.filter((id) => !historyIds.has(id))])
    const scopes = lookupIds.length > 0
      ? await this.deps.actionLogService.findLogScopes({ tenantId: viewer.tenantId, ids: lookupIds })
      : []
    const visibleLogIds = new Set(historyIds)
    for (const scope of scopes) {
      if (isOrganizationInScope(scope.organizationId, viewer.organizationIds)) visibleLogIds.add(scope.id)
    }
    const unresolvedLogIds = new Set(causedByIds.filter((id) => !visibleLogIds.has(id)))
    return { visibleLogIds, unresolvedLogIds }
  }

  /**
   * Load context for cause/reference resolvers and providers: scoped to the record's
   * organization, because their features were checked there. A tenant-level record keeps
   * the viewer's scope.
   */
  private buildRecordLoadContext(viewer: ExplainViewer, organizationId: string | null): ExplainLoadContext {
    const context = this.buildLoadContext(viewer)
    if (!organizationId) return context
    return { ...context, scope: { tenantId: viewer.tenantId, organizationIds: [organizationId] } }
  }

  /**
   * Cheap pre-load gate at the viewer's RBAC organization. It is skipped when that
   * organization is outside the viewer's (feature-narrowed) scope, where it would
   * wrongly deny; the authoritative check runs at the record's organization after load.
   */
  private async passesPreloadGate(
    viewer: ExplainViewer,
    checker: ExplainFeatureChecker,
    requiredFeatures: readonly string[],
  ): Promise<boolean> {
    if (!isOrganizationInScope(checker.organizationId, viewer.organizationIds)) return true
    return checker.has(requiredFeatures)
  }

  private bindChecker(
    viewer: ExplainViewer,
    fallback: ExplainFeatureChecker,
    organizationId: string | null,
  ): ExplainFeatureChecker {
    const bound = createExplainFeatureChecker(this.deps.rbacService, viewer, { organizationId })
    return bound.organizationId === fallback.organizationId ? fallback : bound
  }

  private async loadUserLabels(viewer: ExplainViewer, ids: readonly string[]): Promise<Map<string, string>> {
    const userIds = uniqueStrings(ids)
    const labels = new Map<string, string>()
    if (userIds.length === 0) return labels
    try {
      const users = await findWithDecryption(
        this.deps.em,
        User,
        { id: { $in: userIds }, tenantId: viewer.tenantId, deletedAt: null },
        undefined,
        { tenantId: viewer.tenantId, organizationId: null },
      )
      for (const user of users) {
        const name = typeof user.name === 'string' && user.name.length > 0 ? user.name : null
        const label = name ?? (typeof user.email === 'string' && user.email.length > 0 ? user.email : null)
        if (label) labels.set(String(user.id), label)
      }
    } catch (error) {
      logger.warn('Failed to load actor labels for explain', { err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.actor_labels_failed' })
    }
    return labels
  }

  private visibleUserIds(
    viewer: ExplainViewer,
    visibility: ExplainVisibility,
    candidates: Array<{ actorUserId: string | null; actorKind: ActorKind; onBehalfOfUserId: string | null; causes: EngineCause[] }>,
  ): string[] {
    const ids: string[] = []
    const selfId = viewer.subject.kind === 'user' ? viewer.subject.storageId : null
    const include = (id: string | null) => {
      if (!id) return
      if (visibility.canSeeActors || id === selfId) ids.push(id)
    }
    for (const candidate of candidates) {
      if (candidate.actorKind === 'user') include(candidate.actorUserId)
      include(candidate.onBehalfOfUserId)
      for (const cause of candidate.causes) principalIds(cause).forEach(include)
    }
    return ids
  }

  /**
   * Explains one field (or returns the overview). Every feature check after the record
   * is loaded — resource, field, collection and custom-field features, audit visibility
   * and resolver features — is evaluated at the record's organization, so a feature
   * granted only for another organization never applies here.
   */
  async explain(
    viewer: ExplainViewer,
    query: ExplainQuery,
  ): Promise<ExplainOutcome<ExplainFieldResponse | ExplainOverviewResponse>> {
    if (Array.isArray(viewer.organizationIds) && viewer.organizationIds.length === 0) return notFound()
    const registered = getExplainResource(query.resourceKind)
    if (!registered) return notFound()
    const resource = registered.descriptor
    const resourceFeatures = [EXPLAIN_VIEW_FEATURE, ...resource.requiredFeatures]
    const requestChecker = createExplainFeatureChecker(this.deps.rbacService, viewer)
    if (!(await this.passesPreloadGate(viewer, requestChecker, resourceFeatures))) return notFound()
    const record = await this.loadCurrent(registered, this.buildLoadContext(viewer), viewer, query.resourceId)
    if (!record) return notFound()
    const checker = this.bindChecker(viewer, requestChecker, record.organizationId)
    if (!(await checker.has(resourceFeatures))) return notFound()
    const loadContext = this.buildRecordLoadContext(viewer, record.organizationId)
    const [gate, visibility] = await Promise.all([
      checker.prepare(collectResourceFeatureLists(resource)),
      resolveExplainVisibility(checker),
    ])
    if (!query.field) {
      return { ok: true, body: await this.buildOverview({ viewer, resource, record, gate, visibility }) }
    }
    const resolution = resolveFieldTarget(resource, query.field, query.itemId ?? null, gate)
    if (!resolution.ok) return badRequest(resolution.error)
    const target = resolution.target
    if (!hasCollectionItem(record.current, target)) return notFound()
    const body = await this.buildFieldExplanation({
      viewer,
      registered,
      record,
      gate,
      visibility,
      checker,
      loadContext,
      target,
      query,
    })
    return { ok: true, body }
  }

  private async buildFieldExplanation(params: {
    viewer: ExplainViewer
    registered: RegisteredExplainResource
    record: LoadedRecord
    gate: FeatureGate
    visibility: ExplainVisibility
    checker: ExplainFeatureChecker
    loadContext: ExplainLoadContext
    target: FieldTarget
    query: ExplainQuery
  }): Promise<ExplainFieldResponse> {
    const { viewer, record, gate, visibility, checker, loadContext, target, query } = params
    const current = record.current
    const detailScope: ExplainDetailScope = {
      viewerOrganizationIds: viewer.organizationIds,
      recordOrganizationId: record.organizationId,
    }
    const resource = params.registered.descriptor
    const resourceKinds = resolveLogResourceKinds(resource)
    const before = query.before ? decodeExplainCursor(query.before) : null
    const scan = await scanResourceHistory(this.deps.actionLogService, {
      tenantId: viewer.tenantId,
      organizationIds: viewer.organizationIds,
      resourceKinds,
      resourceId: record.recordId,
      includeChildren: needsChildHistory(resource, target),
      before,
      scanMax: this.scanMax,
    })
    const extraLogIds = scan.entries.flatMap((entry) => logCauseIds(deriveEntryCause(entry).cause))
    const logReferences = await this.resolveLogReferences(viewer, scan.entries, extraLogIds)
    const result = explainField({
      history: scan.entries,
      target,
      subject: { resourceKinds, resourceId: record.recordId },
      current,
      now: this.now(),
      truncated: scan.truncated,
      continuation: before !== null,
      danglingLogIds: logReferences.unresolvedLogIds,
      noHistoryReasonKey: resource.noHistory?.reasonKey ?? null,
      resolveDependency: buildDependencyResolver(resource, gate),
    })

    const page = result.chain.slice(0, query.limit)
    const historyById = new Map(scan.entries.map((entry) => [entry.logId, entry]))
    const actorKinds = new Map<string, ActorKind>()
    for (const entry of page) actorKinds.set(entry.logId, historyById.get(entry.logId)?.actorKind ?? (entry.actorUserId ? 'user' : 'system'))

    const userIds = this.visibleUserIds(viewer, visibility, page.map((entry) => ({
      actorUserId: entry.actorUserId,
      actorKind: actorKinds.get(entry.logId) ?? 'system',
      onBehalfOfUserId: entry.onBehalfOfUserId,
      causes: entry.origin ? [entry.cause, entry.origin] : [entry.cause],
    })))
    const causeRefs = page.flatMap((entry) => [
      ...causeReferences(entry.cause),
      ...(entry.origin ? causeReferences(entry.origin) : []),
    ])
    const [userLabels, causes] = await Promise.all([
      this.loadUserLabels(viewer, userIds),
      resolveCauseDetails({ references: causeRefs, checker, loadContext, detailScope }),
    ])
    const presenter: PresenterContext = {
      viewer,
      visibility,
      causes,
      visibleLogIds: logReferences.visibleLogIds,
      userLabels,
      actorKinds,
    }

    const currentValue = readCurrentValue(current, target)
    const referenceValues: unknown[] = currentValue.known ? [currentValue.value] : []
    for (const entry of page) {
      const actor = presentActor(presenter, entry.logId, entry.actorUserId)
      if (!canSeeEntryValues(visibility, actor.isSelf)) continue
      if (entry.from.known) referenceValues.push(entry.from.value)
      if (entry.to.known) referenceValues.push(entry.to.value)
    }
    const references = target.referenceKind
      ? await resolveReferenceDetails({
        kind: target.referenceKind,
        values: referenceValues,
        checker,
        loadContext,
        detailScope,
      })
      : EMPTY_REFERENCE_INDEX

    const providerHints = await this.runProvider({
      resource,
      target,
      current,
      itemId: query.itemId ?? null,
      history: visibility.canSeePastValues ? scan.entries : [],
      checker,
      loadContext,
      detailScope,
    })

    let nextBefore: string | null = null
    if (result.chain.length > page.length) {
      const last = page.at(-1)
      if (last) nextBefore = encodeExplainCursor({ at: last.cursorAt ?? last.at, id: last.logId })
    } else if (scan.truncated && scan.lastCursor) {
      nextBefore = encodeExplainCursor(scan.lastCursor)
    }

    return {
      resourceKind: resource.resourceKind,
      resourceId: record.recordId,
      field: target.key,
      itemId: target.collection?.itemId ?? null,
      labelKey: target.labelKey,
      current: {
        value: currentValue.known ? toResponseValue(currentValue.value) : null,
        display: currentValue.known ? references.get(currentValue.value)?.label ?? null : null,
        valueKind: target.valueKind,
      },
      verdict: result.verdict,
      confidence: result.confidence,
      summary: { key: result.summary.key, params: result.summary.params },
      chain: page.map((entry: EngineChainEntry) => presentChainEntry(presenter, entry, target.valueKind, references)),
      gaps: result.gaps.map((gap) => ({ ...gap })),
      hints: [...result.hints.map((hint) => ({ key: hint.key, params: hint.params })), ...providerHints],
      dependencies: presentDependencies(result.dependencies),
      page: {
        limit: query.limit,
        nextBefore,
        scanned: scan.scanned,
        truncated: scan.truncated,
        continuation: before !== null,
      },
      viewer: presentViewer(visibility),
    }
  }

  private async runProvider(params: {
    resource: ExplainResourceDescriptor
    target: FieldTarget
    current: Record<string, unknown>
    itemId: string | null
    history: ActionLogFieldHistoryEntry[]
    checker: ExplainFeatureChecker
    loadContext: ExplainLoadContext
    detailScope: ExplainDetailScope
  }): Promise<ExplainHintView[]> {
    const providerId = params.target.provider
    if (!providerId) return []
    const registered = getExplainProvider(providerId)
    const field = findTargetDescriptor(params.resource, params.target)
    if (!registered || !field) return []
    let facts: ExplainProviderFact[]
    try {
      facts = await registered.provider.explain({
        ...params.loadContext,
        resource: params.resource,
        field,
        current: params.current,
        itemId: params.itemId,
        history: params.history,
        resolveReference: (kind, ids) => resolveReferenceKindDetails({
          kind,
          ids,
          checker: params.checker,
          loadContext: params.loadContext,
          detailScope: params.detailScope,
        }),
      })
    } catch (error) {
      logger.error('[internal] Explain provider failed', { providerId, err: error })
      getTelemetryRuntime()?.reportError(error, {
        module: 'insights',
        code: 'insights.provider_failed',
        attributes: { providerId, moduleId: registered.moduleId },
      })
      return [{ key: 'insights.explain.hints.providerFailed', params: {} }]
    }
    const hints: ExplainHintView[] = []
    for (const fact of Array.isArray(facts) ? facts : []) {
      if (!fact || typeof fact.key !== 'string' || fact.key.length === 0) continue
      let reference: ExplainHintView['reference'] = null
      if (fact.reference && typeof fact.reference.kind === 'string' && typeof fact.reference.id === 'string') {
        const [detail] = await resolveReferenceKindDetails({
          kind: fact.reference.kind,
          ids: [fact.reference.id],
          checker: params.checker,
          loadContext: params.loadContext,
          detailScope: params.detailScope,
        })
        reference = detail
          ? { kind: detail.kind, id: detail.id, label: detail.label, href: detail.href }
          : null
      }
      hints.push({
        key: fact.key,
        params: sanitizeHintParams(fact.params),
        confidence: fact.confidence === 'proven' || fact.confidence === 'inferred' ? fact.confidence : 'unknown',
        reference,
      })
    }
    return hints
  }

  private async buildOverview(params: {
    viewer: ExplainViewer
    resource: ExplainResourceDescriptor
    record: LoadedRecord
    gate: FeatureGate
    visibility: ExplainVisibility
  }): Promise<ExplainOverviewResponse> {
    const { viewer, resource, record, gate, visibility } = params
    const current = record.current
    const resourceKinds = resolveLogResourceKinds(resource)
    const targets = listOverviewTargets(resource, current, gate, readCustomFieldKeys)
    const scan = await scanResourceHistory(this.deps.actionLogService, {
      tenantId: viewer.tenantId,
      organizationIds: viewer.organizationIds,
      resourceKinds,
      resourceId: record.recordId,
      includeChildren: false,
      before: null,
      scanMax: this.scanMax,
    })
    const logReferences = await this.resolveLogReferences(viewer, scan.entries, [])
    const now = this.now()
    const fields = targets.map((target) => {
      const result = explainField({
        history: scan.entries,
        target,
        subject: { resourceKinds, resourceId: record.recordId },
        current,
        now,
        truncated: scan.truncated,
        continuation: false,
        danglingLogIds: logReferences.unresolvedLogIds,
        noHistoryReasonKey: resource.noHistory?.reasonKey ?? null,
      })
      return {
        field: target.key,
        labelKey: target.labelKey,
        valueKind: target.valueKind,
        verdict: result.verdict,
        confidence: result.confidence,
        lastChangeAt: result.lastChangeAt,
      }
    })
    const causeKinds: Record<string, number> = {}
    let legacyRows = 0
    for (const entry of scan.entries) {
      const key = entry.causeKind ?? 'legacy'
      if (!entry.causeKind) legacyRows += 1
      causeKinds[key] = (causeKinds[key] ?? 0) + 1
    }
    return {
      resourceKind: resource.resourceKind,
      resourceId: record.recordId,
      fields,
      coverage: {
        scanned: scan.scanned,
        truncated: scan.truncated,
        legacyRows,
        causeKinds,
        noHistory: resource.noHistory ? { reasonKey: resource.noHistory.reasonKey } : null,
        unloggedWriters: targets.flatMap((target) => target.unloggedWriters.map((writer) => ({
          field: target.key,
          id: writer.id,
          labelKey: writer.labelKey,
        }))),
      },
      viewer: presentViewer(visibility),
    }
  }

  async describe(viewer: ExplainViewer): Promise<ExplainDescriptorsResponse> {
    const checker = createExplainFeatureChecker(this.deps.rbacService, viewer)
    if (!(await checker.has([EXPLAIN_VIEW_FEATURE]))) return { resources: [] }
    const resources: ExplainDescriptorsResponse['resources'] = []
    const registeredResources = listExplainResources()
      .slice()
      .sort((left, right) => left.descriptor.resourceKind.localeCompare(right.descriptor.resourceKind))
    for (const registered of registeredResources) {
      const resource = registered.descriptor
      if (!(await checker.has(resource.requiredFeatures))) continue
      const gate = await checker.prepare(collectResourceFeatureLists(resource))
      const describeField = (field: ExplainFieldDescriptor) => ({
        key: field.key,
        labelKey: field.labelKey,
        valueKind: field.valueKind,
        derived: Boolean(field.derived),
        dependsOn: field.derived ? readableDependencyKeys(resource, field.derived.dependsOn, gate) : [],
        provider: field.provider ?? null,
      })
      resources.push({
        resourceKind: resource.resourceKind,
        labelKey: resource.labelKey,
        formEntityIds: resource.formEntityIds ?? [],
        fields: resource.fields.filter((field) => gate(field.requiredFeatures)).map(describeField),
        collections: (resource.collections ?? [])
          .filter((collection) => gate(collection.requiredFeatures))
          .map((collection) => ({
            key: collection.key,
            labelKey: collection.labelKey,
            fields: collection.fields.filter((field) => gate(field.requiredFeatures)).map(describeField),
          })),
        customFields: resource.customFields && gate(resource.customFields.requiredFeatures)
          ? { entityId: resource.customFields.entityId, allowKeys: resource.customFields.allowKeys ?? null }
          : null,
        noHistory: resource.noHistory ? { reasonKey: resource.noHistory.reasonKey } : null,
      })
    }
    return { resources }
  }

  /**
   * Explains one audit entry. Feature checks are evaluated at the entry's organization.
   * When the entry belongs to an explainable record, the viewer scope is re-resolved
   * with that resource's features before the record is loaded, and the resource
   * features must also pass at the record's organization.
   */
  async explainLog(
    viewer: ExplainViewer,
    logId: string,
    options: ExplainLogOptions = {},
  ): Promise<ExplainOutcome<ExplainLogResponse>> {
    if (Array.isArray(viewer.organizationIds) && viewer.organizationIds.length === 0) return notFound()
    const entry = await this.deps.actionLogService.findHistoryEntryById({
      tenantId: viewer.tenantId,
      organizationIds: viewer.organizationIds,
      id: logId,
    })
    if (!entry) return notFound()

    const owner = this.resolveLogOwner(entry)
    if (owner && !owner.resourceId) return notFound()
    const requiredAtEntry = owner
      ? [EXPLAIN_VIEW_FEATURE, ...owner.registered.descriptor.requiredFeatures]
      : [EXPLAIN_VIEW_FEATURE]
    let scopedViewer = viewer
    if (owner && options.rescope) {
      const rescoped = await options.rescope(requiredAtEntry)
      if (!rescoped || rescoped.tenantId !== viewer.tenantId) return notFound()
      if (Array.isArray(rescoped.organizationIds) && rescoped.organizationIds.length === 0) return notFound()
      if (!isOrganizationInScope(entry.organizationId, rescoped.organizationIds)) return notFound()
      scopedViewer = rescoped
    }

    const checker = createExplainFeatureChecker(this.deps.rbacService, scopedViewer, { organizationId: entry.organizationId })
    if (!(await checker.has(requiredAtEntry))) return notFound()
    const visibility = await resolveExplainVisibility(checker)
    const actorIsSelf = entry.actorUserId !== null
      && scopedViewer.subject.kind === entry.actorKind
      && scopedViewer.subject.storageId === entry.actorUserId
    if (!visibility.canSeeActors && !(visibility.canSeeOwnValues && actorIsSelf)) return notFound()

    if (owner?.resourceId) {
      const record = await this.loadCurrent(owner.registered, this.buildLoadContext(scopedViewer), scopedViewer, owner.resourceId)
      if (!record) return notFound()
      const recordChecker = this.bindChecker(scopedViewer, checker, record.organizationId)
      if (recordChecker !== checker && !(await recordChecker.has(requiredAtEntry))) return notFound()
    }
    const loadContext = this.buildRecordLoadContext(scopedViewer, entry.organizationId)

    const { cause, origin } = deriveEntryCause(entry)
    const logReferences = await this.resolveLogReferences(scopedViewer, [entry], [
      ...logCauseIds(cause),
      ...(origin ? logCauseIds(origin) : []),
    ])
    const danglingCausedBy = entry.causedByLogId !== null && logReferences.unresolvedLogIds.has(entry.causedByLogId)
    const actorKinds = new Map<string, ActorKind>([[entry.logId, entry.actorKind]])
    const userIds = this.visibleUserIds(scopedViewer, visibility, [{
      actorUserId: entry.actorUserId,
      actorKind: entry.actorKind,
      onBehalfOfUserId: entry.onBehalfOfUserId,
      causes: origin ? [cause, origin] : [cause],
    }])
    const [userLabels, causes] = await Promise.all([
      this.loadUserLabels(scopedViewer, userIds),
      resolveCauseDetails({
        references: [...causeReferences(cause), ...(origin ? causeReferences(origin) : [])],
        checker,
        loadContext,
        detailScope: { viewerOrganizationIds: scopedViewer.organizationIds, recordOrganizationId: entry.organizationId },
      }),
    ])
    const presenter: PresenterContext = {
      viewer: scopedViewer,
      visibility,
      causes,
      visibleLogIds: logReferences.visibleLogIds,
      userLabels,
      actorKinds,
    }
    const actor = presentActor(presenter, entry.logId, entry.actorUserId)
    const state = entry.executionState === 'undone' ? 'undone' : entry.executionState === 'redone' ? 'redone' : 'done'
    const body: ExplainLogResponse = {
      logId: entry.logId,
      at: entry.at,
      resourceKind: entry.resourceKind,
      resourceId: entry.resourceId,
      commandId: entry.commandId,
      action: entry.actionType,
      state,
      actor,
      onBehalfOf: presentPrincipal(presenter, entry.onBehalfOfUserId),
      cause: presentCause(presenter, cause),
      causedBy: presentCausedBy(presenter, { causedByLogId: entry.causedByLogId, danglingCausedBy, cause }, actor.isSelf),
      correlationId: entry.correlationId,
      confidence: singleEntryConfidence(cause, danglingCausedBy),
      viewer: presentViewer(visibility),
    }
    if (origin) body.origin = presentCause(presenter, origin)
    return { ok: true, body }
  }

  private resolveLogOwner(entry: ActionLogFieldHistoryEntry): { registered: RegisteredExplainResource; resourceId: string | null } | null {
    const own = entry.resourceKind ? findExplainResourceByLogKind(entry.resourceKind) : null
    if (own) return { registered: own, resourceId: entry.resourceId }
    const parent = entry.parentResourceKind ? findExplainResourceByLogKind(entry.parentResourceKind) : null
    if (parent) return { registered: parent, resourceId: entry.parentResourceId }
    return null
  }
}
