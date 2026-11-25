import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import {
  runRouteMutationGuards,
  type RouteMutationGuardOperation,
} from '@open-mercato/shared/lib/crud/route-mutation-guard'
import {
  collectEntityMergeParticipantPreviews,
  type EntityMergeCallerFeatureCheck,
} from '@open-mercato/shared/lib/entities/merge-participants'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  CustomerActivity,
  CustomerComment,
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerDealStageTransition,
  CustomerInteraction,
} from '../../../data/entities'
import {
  dealMergeQuerySchema,
  dealMergeRequestSchema,
  dealMergeResponseSchema,
} from '../../../data/validators'
import {
  resolveAuthActorId,
  resolveCustomersRequestContext,
  type CustomersRequestContext,
} from '../../../lib/interactionRequestContext'

const DEAL_ENTITY_ID = 'customers:customer_deal'

const logger = createLogger('customers').child({ component: 'deals.merge.route' })

const dealMergePreviewRecordSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  fields: z.record(z.string(), z.unknown()),
  customFields: z.record(z.string(), z.unknown()),
  people: z.array(z.object({
    id: z.string().uuid(),
    label: z.string(),
    subtitle: z.string().nullable(),
    isPrimary: z.boolean(),
  })),
  companies: z.array(z.object({
    id: z.string().uuid(),
    label: z.string(),
    subtitle: z.string().nullable(),
  })),
  stageTransitions: z.array(z.object({
    stageId: z.string().uuid(),
    pipelineId: z.string().uuid(),
    stageLabel: z.string(),
    stageOrder: z.number().int(),
    transitionedAt: z.string().datetime(),
  })),
  counts: z.object({
    activities: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    interactions: z.number().int().nonnegative(),
  }),
})

const dealMergePreviewSchema = z.object({
  left: dealMergePreviewRecordSchema,
  right: dealMergePreviewRecordSchema,
  participants: z.array(z.object({
    participantId: z.string(),
    label: z.string(),
    sourceCount: z.number().int().nonnegative(),
    survivorCount: z.number().int().nonnegative(),
    overlapCount: z.number().int().nonnegative(),
  })),
})

const dealMergeErrorSchema = z.object({ error: z.unknown() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Preview or merge two deals',
  methods: {
    GET: {
      summary: 'Preview two scoped deals before merge',
      query: dealMergeQuerySchema,
      responses: [{ status: 200, description: 'Scoped Deal merge preview', schema: dealMergePreviewSchema }],
      errors: [
        { status: 400, description: 'Invalid Deal pair', schema: dealMergeErrorSchema },
        { status: 404, description: 'Deal pair not found in scope', schema: dealMergeErrorSchema },
        { status: 500, description: 'Deal merge preview failed', schema: dealMergeErrorSchema },
      ],
    },
    POST: {
      summary: 'Atomically merge two scoped deals',
      requestBody: { contentType: 'application/json', schema: dealMergeRequestSchema },
      responses: [{ status: 200, description: 'Deals merged', schema: dealMergeResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid merge result', schema: dealMergeErrorSchema },
        { status: 404, description: 'Deal pair not found in scope', schema: dealMergeErrorSchema },
        { status: 409, description: 'One of the Deals changed or was deleted', schema: dealMergeErrorSchema },
        { status: 500, description: 'Deal merge failed', schema: dealMergeErrorSchema },
      ],
    },
  },
}

function associationPayload(link: CustomerDealPersonLink | CustomerDealCompanyLink) {
  const entity = 'person' in link ? link.person : link.company
  const record = typeof entity === 'string' ? null : entity
  return {
    id: typeof entity === 'string' ? entity : entity.id,
    label: record?.displayName ?? (typeof entity === 'string' ? entity : entity.id),
    subtitle: record?.primaryEmail ?? record?.primaryPhone ?? null,
    ...('isPrimary' in link ? { isPrimary: link.isPrimary } : {}),
  }
}

async function loadPreviewRecord(
  em: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['em'],
  deal: CustomerDeal,
) {
  const scope = { tenantId: deal.tenantId, organizationId: deal.organizationId }
  const [people, companies, transitions, customValues, activities, comments, interactions] = await Promise.all([
    findWithDecryption(em, CustomerDealPersonLink, { deal: deal.id }, { populate: ['person'] }, scope),
    findWithDecryption(em, CustomerDealCompanyLink, { deal: deal.id }, { populate: ['company'] }, scope),
    findWithDecryption(em, CustomerDealStageTransition, { deal: deal.id, deletedAt: null }, {
      orderBy: { transitionedAt: 'ASC' },
    }, scope),
    loadCustomFieldValues({
      em,
      entityId: DEAL_ENTITY_ID,
      recordIds: [deal.id],
      tenantIdByRecord: { [deal.id]: deal.tenantId },
      organizationIdByRecord: { [deal.id]: deal.organizationId },
      tenantFallbacks: [deal.tenantId],
    }),
    em.count(CustomerActivity, { deal: deal.id, tenantId: deal.tenantId, organizationId: deal.organizationId }),
    em.count(CustomerComment, { deal: deal.id, tenantId: deal.tenantId, organizationId: deal.organizationId }),
    em.count(CustomerInteraction, { dealId: deal.id, tenantId: deal.tenantId, organizationId: deal.organizationId }),
  ])
  return {
    id: deal.id,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
    fields: {
      title: deal.title,
      description: deal.description ?? null,
      status: deal.status,
      pipelineStage: deal.pipelineStage ?? null,
      pipelineId: deal.pipelineId ?? null,
      pipelineStageId: deal.pipelineStageId ?? null,
      valueAmount: deal.valueAmount == null ? null : Number(deal.valueAmount),
      valueCurrency: deal.valueCurrency ?? null,
      probability: deal.probability ?? null,
      expectedCloseAt: deal.expectedCloseAt?.toISOString() ?? null,
      ownerUserId: deal.ownerUserId ?? null,
      source: deal.source ?? null,
      closureOutcome: deal.closureOutcome === 'won' || deal.closureOutcome === 'lost' ? deal.closureOutcome : null,
      lossReasonId: deal.lossReasonId ?? null,
      lossNotes: deal.lossNotes ?? null,
    },
    customFields: normalizeCustomFieldResponse(customValues[deal.id]) ?? {},
    people: people.map(associationPayload),
    companies: companies.map(associationPayload),
    stageTransitions: transitions.map((transition) => ({
      stageId: transition.stageId,
      pipelineId: transition.pipelineId,
      stageLabel: transition.stageLabel,
      stageOrder: transition.stageOrder,
      transitionedAt: transition.transitionedAt.toISOString(),
    })),
    counts: { activities, comments, interactions },
  }
}

type Translate = (key: string, fallback?: string) => string

async function respondWithError(error: unknown, operation: 'preview' | 'merge'): Promise<Response> {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  const { translate } = await resolveTranslations()
  if (error instanceof z.ZodError) {
    return NextResponse.json({
      error: translate('customers.deals.merge.errors.validation_failed', 'Deal merge request is invalid'),
      details: error.issues,
    }, { status: 400 })
  }
  const code = operation === 'preview' ? 'customers.deal_merge_preview_failed' : 'customers.deal_merge_failed'
  logger.error(operation === 'preview' ? 'Deal merge preview failed' : 'Deal merge failed', { err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'customers', code })
  return NextResponse.json({
    error: operation === 'preview'
      ? translate('customers.deals.merge.errors.preview_failed', 'Failed to load the deals for comparison')
      : translate('customers.deals.merge.errors.merge_failed', 'Deal merge failed'),
  }, { status: 500 })
}

function notFoundError(translate: Translate) {
  return notFound(translate('customers.deals.merge.errors.not_found', 'Deal not found'))
}

function createCallerFeatureCheck(
  context: CustomersRequestContext,
  organizationId: string,
): EntityMergeCallerFeatureCheck {
  return async (required) => {
    if (required.length === 0) return true
    let rbac: RbacService | undefined
    try {
      rbac = context.container.resolve('rbacService') as RbacService | undefined
    } catch (error) {
      logger.warn('rbacService unavailable for Deal merge preview feature check', { err: error })
      return false
    }
    if (!rbac) return false
    return rbac.userHasAllFeatures(resolveAuthActorId(context.auth), [...required], {
      tenantId: context.auth.tenantId,
      organizationId,
    })
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { translate } = await resolveTranslations()
    const context = await resolveCustomersRequestContext(request)
    const query = dealMergeQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()))
    if (!context.selectedOrganizationId) throw notFoundError(translate)
    const deals = await findWithDecryption(context.em, CustomerDeal, {
      id: { $in: [query.left, query.right] },
      tenantId: context.auth.tenantId,
      organizationId: context.selectedOrganizationId,
      deletedAt: null,
    }, {}, { tenantId: context.auth.tenantId, organizationId: context.selectedOrganizationId })
    const left = deals.find((deal) => deal.id === query.left)
    const right = deals.find((deal) => deal.id === query.right)
    if (!left || !right) throw notFoundError(translate)
    const [leftPreview, rightPreview, participantPreviews] = await Promise.all([
      loadPreviewRecord(context.em, left),
      loadPreviewRecord(context.em, right),
      collectEntityMergeParticipantPreviews({
        em: context.em,
        entityId: DEAL_ENTITY_ID,
        survivorId: left.id,
        sourceId: right.id,
        tenantId: context.auth.tenantId,
        organizationId: context.selectedOrganizationId,
        callerHasFeatures: createCallerFeatureCheck(context, context.selectedOrganizationId),
      }),
    ])
    return NextResponse.json({ left: leftPreview, right: rightPreview, participants: participantPreviews })
  } catch (error) {
    return respondWithError(error, 'preview')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { translate } = await resolveTranslations()
    const context = await resolveCustomersRequestContext(request)
    let input = dealMergeRequestSchema.parse(await readJsonSafe(request, {}))
    if (!context.selectedOrganizationId) throw notFoundError(translate)
    const auth = {
      tenantId: context.auth.tenantId,
      organizationId: context.selectedOrganizationId,
      userId: resolveAuthActorId(context.auth),
    }
    const afterSuccess: Array<() => Promise<void>> = []
    const guardTargets: Array<{ resourceId: string; operation: RouteMutationGuardOperation }> = [
      { resourceId: input.survivorId, operation: 'custom' },
      { resourceId: input.sourceId, operation: 'delete' },
    ]
    for (const { resourceId, operation } of guardTargets) {
      const guarded = await runRouteMutationGuards({
        container: context.container,
        req: request,
        auth,
        input: {
          resourceKind: 'customers.deal',
          resourceId,
          operation,
          mutationPayload: input,
        },
      })
      if (!guarded.ok) return guarded.response
      if (guarded.modifiedPayload) input = dealMergeRequestSchema.parse(guarded.modifiedPayload)
      afterSuccess.push(guarded.runAfterSuccess)
    }
    const commandBus = context.container.resolve('commandBus') as CommandBus
    await commandBus.execute('customers.deals.merge', {
      input,
      ctx: context.commandContext,
    })
    for (const runAfterSuccess of afterSuccess) await runAfterSuccess()
    return NextResponse.json(dealMergeResponseSchema.parse({
      ok: true,
      survivorId: input.survivorId,
      sourceId: input.sourceId,
    }), { status: 200 })
  } catch (error) {
    const interceptorRejection = getCommandInterceptorHttpRejection(error)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    return respondWithError(error, 'merge')
  }
}
