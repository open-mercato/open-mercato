import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerDeal,
  CustomerDealPersonLink,
  CustomerDealCompanyLink,
  CustomerDealStageTransition,
  CustomerDictionaryEntry,
  CustomerEntity,
  CustomerPipeline,
  CustomerPipelineStage,
} from '../../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '#generated/entities.ids.generated'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { decryptEntitiesWithFallbackScope } from '@open-mercato/shared/lib/encryption/subscriber'
import { runWithCacheTenant } from '@open-mercato/cache'
import {
  buildCollectionTags,
  debugCrudCache,
  expandResourceAliases,
  isCrudCacheEnabled,
  resolveCrudCache,
} from '@open-mercato/shared/lib/crud/cache'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isMissingDealStageTransitionTable, warnMissingDealStageTransitionTable } from '../../../lib/dealStageTransitionTable'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
}

const paramsSchema = z.object({
  id: z.string().uuid(),
})

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 })
}

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
}

type DealAssociation = {
  id: string
  label: string
  subtitle: string | null
  kind: 'person' | 'company'
}

function normalizePersonAssociation(entity: CustomerEntity): { label: string; subtitle: string | null } {
  const displayName = typeof entity.displayName === 'string' ? entity.displayName.trim() : ''
  const email =
    typeof entity.primaryEmail === 'string' && entity.primaryEmail.trim().length
      ? entity.primaryEmail.trim()
      : null
  const phone =
    typeof entity.primaryPhone === 'string' && entity.primaryPhone.trim().length
      ? entity.primaryPhone.trim()
      : null
  const jobTitle =
    entity.personProfile &&
    typeof (entity.personProfile as { jobTitle?: string | null })?.jobTitle === 'string' &&
    (entity.personProfile as { jobTitle?: string | null }).jobTitle?.trim().length
      ? ((entity.personProfile as { jobTitle?: string | null }).jobTitle as string).trim()
      : null
  const subtitle = jobTitle ?? email ?? phone ?? null
  const label = displayName.length ? displayName : email ?? phone ?? entity.id
  return { label, subtitle }
}

function normalizeCompanyAssociation(entity: CustomerEntity): { label: string; subtitle: string | null } {
  const displayName = typeof entity.displayName === 'string' ? entity.displayName.trim() : ''
  const domain =
    entity.companyProfile &&
    typeof (entity.companyProfile as { domain?: string | null })?.domain === 'string' &&
    (entity.companyProfile as { domain?: string | null }).domain?.trim().length
      ? ((entity.companyProfile as { domain?: string | null }).domain as string).trim()
      : null
  const website =
    entity.companyProfile &&
    typeof (entity.companyProfile as { websiteUrl?: string | null })?.websiteUrl === 'string' &&
    (entity.companyProfile as { websiteUrl?: string | null }).websiteUrl?.trim().length
      ? ((entity.companyProfile as { websiteUrl?: string | null }).websiteUrl as string).trim()
      : null
  const subtitle = domain ?? website ?? null
  const label = displayName.length ? displayName : domain ?? website ?? entity.id
  return { label, subtitle }
}

function readIncludeFlags(request: Request): Set<string> {
  const flags = new Set<string>()
  const url = new URL(request.url)
  for (const rawValue of url.searchParams.getAll('include')) {
    rawValue
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .forEach((value) => flags.add(value))
  }
  return flags
}

function readViewMode(request: Request): 'full' | 'lite' {
  const raw = new URL(request.url).searchParams.get('view')
  return raw === 'lite' || raw === 'detail-lite' ? 'lite' : 'full'
}

function normalizeStageLabel(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

type StageTransitionPayload = {
  stageId: string
  stageLabel: string
  stageOrder: number
  transitionedAt: string
}

type DealSnapshotStageInfo = {
  pipelineId: string | null
  stageId: string | null
  stageLabel: string | null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readRecordString(record: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function readSnapshotDealRecord(snapshot: unknown): Record<string, unknown> | null {
  const root = asObject(snapshot)
  if (!root) return null
  return asObject(root.deal) ?? root
}

function readSnapshotStageInfo(snapshot: unknown): DealSnapshotStageInfo {
  const dealRecord = readSnapshotDealRecord(snapshot)
  return {
    pipelineId: readRecordString(dealRecord, 'pipelineId', 'pipeline_id'),
    stageId: readRecordString(dealRecord, 'pipelineStageId', 'pipeline_stage_id'),
    stageLabel: readRecordString(dealRecord, 'pipelineStage', 'pipeline_stage'),
  }
}

async function loadAuditStageTransitionsFallback({
  container,
  deal,
  pipelineStages,
}: {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  deal: CustomerDeal
  pipelineStages: CustomerPipelineStage[]
}): Promise<StageTransitionPayload[]> {
  if (!deal.tenantId || !deal.organizationId || !pipelineStages.length) return []

  let actionLogs: ActionLogService | null = null
  try {
    actionLogs = container.resolve('actionLogService') as ActionLogService
  } catch {
    return []
  }
  if (!actionLogs || typeof actionLogs.list !== 'function') return []
  const stageOrderById = new Map(pipelineStages.map((stage) => [stage.id, stage.order]))
  const stageLabelById = new Map(pipelineStages.map((stage) => [stage.id, stage.label]))
  const transitionsByStageId = new Map<string, StageTransitionPayload>()
  const logsResult = await actionLogs.list({
    tenantId: deal.tenantId,
    organizationId: deal.organizationId,
    resourceKind: 'customers.deal',
    resourceId: deal.id,
    limit: 200,
    offset: 0,
    sortField: 'createdAt',
    sortDir: 'asc',
  }).catch(() => null)
  const logs = logsResult?.items ?? []

  let previousStageId: string | null = null
  for (const log of logs) {
    if (log.executionState === 'failed' || log.executionState === 'undone') continue

    const before = readSnapshotStageInfo(log.snapshotBefore)
    const after = readSnapshotStageInfo(log.snapshotAfter)
    const nextStageId = after.stageId
    if (!nextStageId) continue

    const stageOrder = stageOrderById.get(nextStageId)
    if (typeof stageOrder !== 'number') {
      previousStageId = nextStageId
      continue
    }

    const effectivePreviousStageId: string | null = before.stageId ?? previousStageId
    if (effectivePreviousStageId === nextStageId && transitionsByStageId.has(nextStageId)) {
      previousStageId = nextStageId
      continue
    }

    transitionsByStageId.set(nextStageId, {
      stageId: nextStageId,
      stageLabel: after.stageLabel ?? stageLabelById.get(nextStageId) ?? nextStageId,
      stageOrder,
      transitionedAt: log.createdAt.toISOString(),
    })
    previousStageId = nextStageId
  }

  return Array.from(transitionsByStageId.values()).sort((left, right) => left.stageOrder - right.stageOrder)
}

function mergeStageTransitions({
  persisted,
  recovered,
  currentStage,
  fallbackTimestamp,
}: {
  persisted: StageTransitionPayload[]
  recovered: StageTransitionPayload[]
  currentStage: { id: string; label: string; order: number } | null
  fallbackTimestamp: string
}): StageTransitionPayload[] {
  const merged = new Map<string, StageTransitionPayload>()
  for (const transition of persisted) {
    merged.set(transition.stageId, transition)
  }
  for (const transition of recovered) {
    if (!merged.has(transition.stageId)) {
      merged.set(transition.stageId, transition)
    }
  }
  if (currentStage && !merged.has(currentStage.id)) {
    merged.set(currentStage.id, {
      stageId: currentStage.id,
      stageLabel: currentStage.label,
      stageOrder: currentStage.order,
      transitionedAt: fallbackTimestamp,
    })
  }
  return Array.from(merged.values()).sort((left, right) => left.stageOrder - right.stageOrder)
}

async function loadPipelineStageAppearanceMap(
  em: EntityManager,
  stages: CustomerPipelineStage[],
  organizationId: string,
  tenantId: string,
): Promise<Map<string, CustomerDictionaryEntry>> {
  const normalizedValues = stages
    .map((stage) => stage.label.trim().toLowerCase())
    .filter((value) => value.length > 0)
  if (!normalizedValues.length) return new Map<string, CustomerDictionaryEntry>()
  const entries = await findWithDecryption(
    em,
    CustomerDictionaryEntry,
    {
      organizationId,
      tenantId,
      kind: 'pipeline_stage',
      normalizedValue: { $in: normalizedValues },
    },
    undefined,
    { tenantId, organizationId },
  )
  const map = new Map<string, CustomerDictionaryEntry>()
  entries.forEach((entry) => map.set(entry.normalizedValue, entry))
  return map
}

async function resolveEffectivePipelineStage(
  em: EntityManager,
  deal: CustomerDeal,
  decryptionScope: { tenantId: string | null; organizationId: string | null },
): Promise<CustomerPipelineStage | null> {
  if (deal.pipelineStageId) {
    const exactStage = await findOneWithDecryption(
      em,
      CustomerPipelineStage,
      {
        id: deal.pipelineStageId,
        organizationId: deal.organizationId,
        tenantId: deal.tenantId,
      },
      {},
      decryptionScope,
    )
    if (exactStage) return exactStage
  }

  const normalizedStageLabel = normalizeStageLabel(deal.pipelineStage)
  if (!normalizedStageLabel) return null

  const scopedStages = await findWithDecryption(
    em,
    CustomerPipelineStage,
    {
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
      ...(deal.pipelineId ? { pipelineId: deal.pipelineId } : {}),
    },
    { orderBy: { order: 'ASC' } },
    decryptionScope,
  )

  const matchingStages = scopedStages.filter((stage) => normalizeStageLabel(stage.label) === normalizedStageLabel)
  if (matchingStages.length === 1) return matchingStages[0] ?? null
  if (matchingStages.length > 1) {
    const distinctPipelineIds = new Set(matchingStages.map((stage) => stage.pipelineId))
    if (distinctPipelineIds.size === 1) return matchingStages[0] ?? null
  }
  return null
}

const DEAL_DETAIL_CACHE_RESOURCE = 'customers.deal'
// Every entity the detail payload reads, expressed with the same resourceKind
// strings the customers commands declare. `expandResourceAliases` canonicalizes
// them exactly the way `invalidateCrudCache` does on the write side (camelCase is
// split, `_`/`-` become `.`), so `customers.pipelineStage` resolves to
// `customers.pipeline.stage` and `customers.dictionary_entry` to
// `customers.dictionary.entry`. That guarantees the collection tags stored here
// match the ones the deal/pipeline/stage/dictionary commands flush.
const DEAL_DETAIL_CACHE_TAG_RESOURCES = [
  'customers.pipeline',
  'customers.pipelineStage',
  'customers.dictionary_entry',
]
const DEAL_DETAIL_CACHE_TTL_MS = 60_000

type DealDetailCacheAuth = {
  isSuperAdmin?: boolean | null
  orgId?: string | null
}

// Capture every input `isOrganizationReadAccessAllowed` consults, so two requests
// that share a signature also share an authorization outcome for the same deal.
// The lookup runs after the access check, so this is defense in depth plus the
// per-scope cache partitioning the issue asks for.
function buildDealDetailScopeSignature(
  auth: DealDetailCacheAuth,
  scope: Pick<OrganizationScope, 'allowedIds' | 'filterIds'> | null | undefined,
): string {
  if (auth?.isSuperAdmin === true) return 'super'
  if (scope?.allowedIds === null) return 'all'
  const filterIds = Array.isArray(scope?.filterIds)
    ? scope!.filterIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  if (filterIds.length) return `filter:${[...filterIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(',')}`
  return `home:${auth?.orgId ?? 'null'}`
}

function buildDealDetailCacheKey(params: {
  tenantId: string | null
  organizationId: string | null
  dealId: string
  scopeSignature: string
  view: 'full' | 'lite'
  includeKey: string
}): string {
  return [
    'customers:deal:detail',
    `tenant=${params.tenantId ?? 'null'}`,
    `org=${params.organizationId ?? 'null'}`,
    `deal=${params.dealId}`,
    `scope=${params.scopeSignature}`,
    `view=${params.view}`,
    `include=${params.includeKey}`,
  ].join(':')
}

function buildDealDetailCacheTags(tenantId: string | null, organizationId: string | null): string[] {
  const tags = new Set<string>()
  for (const key of expandResourceAliases(DEAL_DETAIL_CACHE_RESOURCE, DEAL_DETAIL_CACHE_TAG_RESOURCES)) {
    for (const tag of buildCollectionTags(key, tenantId, [organizationId])) {
      tags.add(tag)
    }
  }
  return Array.from(tags)
}

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  const parsedParams = paramsSchema.safeParse(context.params)
  if (!parsedParams.success) {
    return notFound('Deal not found')
  }

  const includeFlags = readIncludeFlags(request)
  const viewMode = readViewMode(request)
  const liteView = viewMode === 'lite'
  const includeStages = includeFlags.has('stages')
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }

  if (!rbac || !auth?.sub) {
    return forbidden('Access denied')
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['customers.deals.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return forbidden('Access denied')
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = (container.resolve('em') as EntityManager)

  const deal = await findOneWithDecryption(
    em,
    CustomerDeal,
    { id: parsedParams.data.id, deletedAt: null },
    {
      populate: ['people.person', 'people.person.personProfile', 'companies.company', 'companies.company.companyProfile'],
    },
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  )
  if (!deal) {
    return notFound('Deal not found')
  }

  if (auth.tenantId && deal.tenantId && auth.tenantId !== deal.tenantId) {
    return notFound('Deal not found')
  }

  if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId: deal.organizationId })) {
    return forbidden('Access denied')
  }

  const decryptionScope = {
    tenantId: deal.tenantId ?? auth.tenantId ?? null,
    organizationId: deal.organizationId ?? auth.orgId ?? null,
  }

  const viewerUserId = auth.isApiKey ? null : auth.sub ?? null
  const resolveViewer = async (): Promise<{ name: string | null; email: string | null }> => {
    if (!viewerUserId) {
      return { name: null, email: auth.email ?? null }
    }
    const viewer = await findOneWithDecryption(
      em,
      User,
      { id: viewerUserId, tenantId: auth.tenantId ?? null },
      {},
      { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
    )
    return {
      name: viewer?.name ?? null,
      email: viewer?.email ?? auth.email ?? null,
    }
  }

  // Opt-in detail cache (ENABLE_CRUD_API_CACHE). The lookup runs after the deal is
  // resolved and the tenant + organization read-access checks pass, so the cache
  // only ever memoizes a payload this caller is already authorized to see; it then
  // skips the heavy association / custom-field / pipeline-stage / dictionary /
  // audit-fallback sweeps below. The viewer block is request-specific, so it is
  // excluded from the cached value and always resolved fresh.
  const cacheTenantId = deal.tenantId ?? auth.tenantId ?? null
  const cacheOrganizationId = deal.organizationId ?? null
  const detailCache = isCrudCacheEnabled() ? resolveCrudCache(container) : null
  const includeKey = includeFlags.size ? Array.from(includeFlags).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(',') : 'none'
  const detailCacheKey = detailCache
    ? buildDealDetailCacheKey({
        tenantId: cacheTenantId,
        organizationId: cacheOrganizationId,
        dealId: deal.id,
        scopeSignature: buildDealDetailScopeSignature(auth, scope),
        view: viewMode,
        includeKey,
      })
    : null

  if (detailCache && detailCacheKey) {
    try {
      const cached = await runWithCacheTenant(cacheTenantId, () => detailCache.get(detailCacheKey))
      if (cached && typeof cached === 'object') {
        const viewerInfo = await resolveViewer()
        return NextResponse.json({
          ...(cached as Record<string, unknown>),
          viewer: {
            userId: viewerUserId,
            name: viewerInfo.name,
            email: viewerInfo.email,
          },
        })
      }
    } catch (err) {
      // A cache-backend read error must degrade to a fresh DB read, never a 500.
      debugCrudCache('get', {
        resource: DEAL_DETAIL_CACHE_RESOURCE,
        key: detailCacheKey,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Issue #3175: the reads below only depend on the already-resolved deal +
  // organization scope + decryption scope, so they are grouped into Promise.all
  // batches instead of being awaited one after another. True dependencies stay
  // ordered: preview/decrypt run after their link rows, pipeline reads after the
  // effective stage is known, and the appearance map / audit fallback after the
  // pipeline stages load. This mirrors the parallel-read pattern already used
  // across the customers list/interactions/activities routes.
  const resolveAssociations = async (): Promise<{
    people: DealAssociation[]
    companies: DealAssociation[]
    linkedPersonIds: string[]
    linkedCompanyIds: string[]
  }> => {
    if (liteView) {
      const [personLinkRows, companyLinkRows] = await Promise.all([
        findWithDecryption(
          em,
          CustomerDealPersonLink,
          { deal: deal.id },
          { orderBy: { createdAt: 'ASC' } },
          decryptionScope,
        ),
        findWithDecryption(
          em,
          CustomerDealCompanyLink,
          { deal: deal.id },
          { orderBy: { createdAt: 'ASC' } },
          decryptionScope,
        ),
      ])

      const linkedPersonIds = Array.from(
        new Set(
          personLinkRows
            .map((link) => {
              const personRef = link.person
              if (!personRef) return null
              if (typeof personRef === 'string') return personRef
              const personIdValue = personRef.id
              return typeof personIdValue === 'string' ? personIdValue : null
            })
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
        ),
      )
      const linkedCompanyIds = Array.from(
        new Set(
          companyLinkRows
            .map((link) => {
              const companyRef = link.company
              if (!companyRef) return null
              if (typeof companyRef === 'string') return companyRef
              const companyIdValue = companyRef.id
              return typeof companyIdValue === 'string' ? companyIdValue : null
            })
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
        ),
      )

      const [previewPeople, previewCompanies] = await Promise.all([
        linkedPersonIds.length
          ? findWithDecryption(
              em,
              CustomerEntity,
              { id: { $in: linkedPersonIds.slice(0, 3) } },
              { populate: ['personProfile'] },
              decryptionScope,
            )
          : [],
        linkedCompanyIds.length
          ? findWithDecryption(
              em,
              CustomerEntity,
              { id: { $in: linkedCompanyIds.slice(0, 3) } },
              { populate: ['companyProfile'] },
              decryptionScope,
            )
          : [],
      ])
      const previewPeopleMap = new Map(previewPeople.map((entity) => [entity.id, entity]))
      const previewCompaniesMap = new Map(previewCompanies.map((entity) => [entity.id, entity]))
      const people = linkedPersonIds.slice(0, 3).reduce<DealAssociation[]>((acc, personId) => {
        const entity = previewPeopleMap.get(personId) ?? null
        if (!entity || entity.deletedAt) return acc
        const { label, subtitle } = normalizePersonAssociation(entity)
        acc.push({ id: entity.id, label, subtitle, kind: 'person' })
        return acc
      }, [])
      const companies = linkedCompanyIds.slice(0, 3).reduce<DealAssociation[]>((acc, companyId) => {
        const entity = previewCompaniesMap.get(companyId) ?? null
        if (!entity || entity.deletedAt) return acc
        const { label, subtitle } = normalizeCompanyAssociation(entity)
        acc.push({ id: entity.id, label, subtitle, kind: 'company' })
        return acc
      }, [])
      return { people, companies, linkedPersonIds, linkedCompanyIds }
    }

    const [personLinks, companyLinks] = await Promise.all([
      findWithDecryption(
        em,
        CustomerDealPersonLink,
        { deal: deal.id },
        { populate: ['person', 'person.personProfile'] },
        decryptionScope,
      ),
      findWithDecryption(
        em,
        CustomerDealCompanyLink,
        { deal: deal.id },
        { populate: ['company', 'company.companyProfile'] },
        decryptionScope,
      ),
    ])
    const fallbackTenantId = deal.tenantId ?? auth.tenantId ?? null
    const fallbackOrgId = deal.organizationId ?? auth.orgId ?? null
    await decryptEntitiesWithFallbackScope(personLinks, {
      em,
      tenantId: fallbackTenantId,
      organizationId: fallbackOrgId,
    })
    await decryptEntitiesWithFallbackScope(companyLinks, {
      em,
      tenantId: fallbackTenantId,
      organizationId: fallbackOrgId,
    })

    const people = personLinks.reduce<DealAssociation[]>((acc, link) => {
      const entity = link.person as CustomerEntity | null
      if (!entity || entity.deletedAt) return acc
      const { label, subtitle } = normalizePersonAssociation(entity)
      acc.push({ id: entity.id, label, subtitle, kind: 'person' })
      return acc
    }, [])

    const companies = companyLinks.reduce<DealAssociation[]>((acc, link) => {
      const entity = link.company as CustomerEntity | null
      if (!entity || entity.deletedAt) return acc
      const { label, subtitle } = normalizeCompanyAssociation(entity)
      acc.push({ id: entity.id, label, subtitle, kind: 'company' })
      return acc
    }, [])
    return {
      people,
      companies,
      linkedPersonIds: people.map((entry) => entry.id),
      linkedCompanyIds: companies.map((entry) => entry.id),
    }
  }

  const resolveOwner = async () =>
    deal.ownerUserId
      ? await findOneWithDecryption(
        em,
        User,
        { id: deal.ownerUserId, tenantId: deal.tenantId ?? auth.tenantId ?? null },
        {},
        decryptionScope,
      )
      : null

  const resolveStageTransitions = async (): Promise<CustomerDealStageTransition[]> => {
    if (!includeStages) return []
    try {
      return await findWithDecryption(
        em,
        CustomerDealStageTransition,
        { deal: deal.id, deletedAt: null },
        { orderBy: { stageOrder: 'ASC', transitionedAt: 'ASC' } },
        decryptionScope,
      )
    } catch (error) {
      if (!isMissingDealStageTransitionTable(error)) {
        throw error
      }
      warnMissingDealStageTransitionTable('customers.api.deals.detail.GET')
      return []
    }
  }

  const [associations, customFieldValues, viewerInfo, owner, effectiveStage, stageTransitions] = await Promise.all([
    resolveAssociations(),
    loadCustomFieldValues({
      em,
      entityId: E.customers.customer_deal,
      recordIds: [deal.id],
      tenantIdByRecord: { [deal.id]: deal.tenantId ?? null },
      organizationIdByRecord: { [deal.id]: deal.organizationId ?? null },
      tenantFallbacks: [deal.tenantId ?? auth.tenantId ?? null].filter((value): value is string => !!value),
    }),
    resolveViewer(),
    resolveOwner(),
    includeStages ? resolveEffectivePipelineStage(em, deal, decryptionScope) : Promise.resolve(null),
    resolveStageTransitions(),
  ])

  const { people, companies, linkedPersonIds, linkedCompanyIds } = associations
  const customFields = normalizeCustomFieldResponse(customFieldValues[deal.id]) ?? {}
  const viewerName = viewerInfo.name
  const viewerEmail = viewerInfo.email
  const ownerPayload = owner
    ? {
      id: owner.id,
      name: owner.name ?? owner.email ?? owner.id,
      email: owner.email ?? '',
    }
    : null

  const effectivePipelineId = deal.pipelineId ?? effectiveStage?.pipelineId ?? null
  const effectivePipelineStageId = deal.pipelineStageId ?? effectiveStage?.id ?? null
  const effectivePipelineStageLabel = deal.pipelineStage ?? effectiveStage?.label ?? null

  const [pipelineStages, pipeline] = await Promise.all([
    includeStages && effectivePipelineId
      ? findWithDecryption(
        em,
        CustomerPipelineStage,
        {
          pipelineId: effectivePipelineId,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
        },
        { orderBy: { order: 'ASC' } },
        decryptionScope,
      )
      : [],
    effectivePipelineId
      ? findOneWithDecryption(
        em,
        CustomerPipeline,
        {
          id: effectivePipelineId,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
        },
        {},
        decryptionScope,
      )
      : null,
  ])

  const persistedStageTransitions = stageTransitions.map((transition) => ({
    stageId: transition.stageId,
    stageLabel: transition.stageLabel,
    stageOrder: transition.stageOrder,
    transitionedAt: transition.transitionedAt.toISOString(),
  }))
  const [pipelineStageAppearanceMap, recoveredStageTransitions] = await Promise.all([
    pipelineStages.length
      ? loadPipelineStageAppearanceMap(em, pipelineStages, deal.organizationId, deal.tenantId)
      : new Map<string, CustomerDictionaryEntry>(),
    includeStages && persistedStageTransitions.length === 0
      ? loadAuditStageTransitionsFallback({ container, deal, pipelineStages })
      : [],
  ])
  const effectiveCurrentStage = (() => {
    if (!effectivePipelineStageId) return null
    const matchingStage = pipelineStages.find((stage) => stage.id === effectivePipelineStageId)
    if (matchingStage) {
      return {
        id: matchingStage.id,
        label: matchingStage.label,
        order: matchingStage.order,
      }
    }
    if (!effectivePipelineStageLabel) return null
    return {
      id: effectivePipelineStageId,
      label: effectivePipelineStageLabel,
      order: 0,
    }
  })()
  const stageTransitionPayload = mergeStageTransitions({
    persisted: persistedStageTransitions,
    recovered: recoveredStageTransitions,
    currentStage: effectiveCurrentStage,
    fallbackTimestamp: deal.createdAt.toISOString(),
  })

  const viewer = {
    userId: viewerUserId,
    name: viewerName,
    email: viewerEmail,
  }

  // Everything except the request-specific viewer block is shareable across
  // authorized callers, so it is what gets cached.
  const cacheableBody = {
    deal: {
      id: deal.id,
      title: deal.title,
      description: deal.description ?? null,
      status: deal.status ?? null,
      pipelineStage: effectivePipelineStageLabel,
      pipelineId: effectivePipelineId,
      pipelineStageId: effectivePipelineStageId,
      valueAmount: deal.valueAmount ?? null,
      valueCurrency: deal.valueCurrency ?? null,
      probability: deal.probability ?? null,
      expectedCloseAt: deal.expectedCloseAt ? deal.expectedCloseAt.toISOString() : null,
      ownerUserId: deal.ownerUserId ?? null,
      source: deal.source ?? null,
      closureOutcome: deal.closureOutcome ?? null,
      lossReasonId: deal.lossReasonId ?? null,
      lossNotes: deal.lossNotes ?? null,
      organizationId: deal.organizationId ?? null,
      tenantId: deal.tenantId ?? null,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    },
    people,
    companies,
    linkedPersonIds,
    linkedCompanyIds,
    counts: {
      people: linkedPersonIds.length,
      companies: linkedCompanyIds.length,
    },
    customFields,
    pipelineStages: pipelineStages.map((stage) => {
      const appearance = pipelineStageAppearanceMap.get(stage.label.trim().toLowerCase())
      return {
        id: stage.id,
        label: stage.label,
        order: stage.order,
        color: appearance?.color ?? null,
        icon: appearance?.icon ?? null,
      }
    }),
    pipelineName: pipeline?.name ?? null,
    stageTransitions: stageTransitionPayload,
    owner: ownerPayload,
  }

  if (detailCache && detailCacheKey) {
    try {
      await runWithCacheTenant(cacheTenantId, () =>
        detailCache.set(detailCacheKey, cacheableBody, {
          ttl: DEAL_DETAIL_CACHE_TTL_MS,
          tags: buildDealDetailCacheTags(cacheTenantId, cacheOrganizationId),
        }),
      )
    } catch (err) {
      // A cache write must never break the request; log it for observability
      // instead of failing the response (matches the CRUD factory).
      debugCrudCache('store', {
        resource: DEAL_DETAIL_CACHE_RESOURCE,
        key: detailCacheKey,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ...cacheableBody, viewer })
}

const dealDetailQuerySchema = z.object({
  include: z.string().optional(),
})

const pipelineStageInfoSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  order: z.number().int(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
})

const stageTransitionInfoSchema = z.object({
  stageId: z.string().uuid(),
  stageLabel: z.string(),
  stageOrder: z.number().int(),
  transitionedAt: z.string(),
})

const dealDetailResponseSchema = z.object({
  deal: z.object({
    id: z.string().uuid(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    pipelineStage: z.string().nullable().optional(),
    pipelineId: z.string().uuid().nullable().optional(),
    pipelineStageId: z.string().uuid().nullable().optional(),
    valueAmount: z.string().nullable().optional(),
    valueCurrency: z.string().nullable().optional(),
    probability: z.number().nullable().optional(),
    expectedCloseAt: z.string().nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    source: z.string().nullable().optional(),
    closureOutcome: z.enum(['won', 'lost']).nullable().optional(),
    lossReasonId: z.string().uuid().nullable().optional(),
    lossNotes: z.string().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  people: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      subtitle: z.string().nullable().optional(),
      kind: z.literal('person'),
    }),
  ),
  companies: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      subtitle: z.string().nullable().optional(),
      kind: z.literal('company'),
    }),
  ),
  customFields: z.record(z.string(), z.unknown()),
  viewer: z.object({
    userId: z.string().uuid().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  pipelineStages: z.array(pipelineStageInfoSchema),
  stageTransitions: z.array(stageTransitionInfoSchema),
  owner: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string(),
  }).nullable(),
})

const dealDetailErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Fetch deal detail',
  methods: {
    GET: {
      summary: 'Fetch deal with associations and pipeline context',
      description: 'Returns a deal with linked people, companies, closure fields, optional pipeline history, custom fields, and viewer context.',
      query: dealDetailQuerySchema,
      responses: [
        { status: 200, description: 'Deal detail payload', schema: dealDetailResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: dealDetailErrorSchema },
        { status: 403, description: 'Forbidden for tenant/organization scope', schema: dealDetailErrorSchema },
        { status: 404, description: 'Deal not found', schema: dealDetailErrorSchema },
      ],
    },
  },
}
