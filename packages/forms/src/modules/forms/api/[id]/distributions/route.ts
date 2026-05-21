import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FormDistribution } from '../../../data/entities'
import {
  distributionCreateCommandSchema,
  type FormDistributionCreateCommandInput,
} from '../../../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from '../../helpers'
import { findFormInScope } from '../../../commands/shared'
import { FORM_DISTRIBUTION_RESOURCE_KIND } from '../../../commands/distribution'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.distribute'] },
  POST: { requireAuth: true, requireFeatures: ['forms.distribute'] },
}

const distributionItemSchema = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  mode: z.enum(['open', 'personal']),
  status: z.enum(['active', 'paused', 'closed']),
  publicSlug: z.string().nullable(),
  title: z.string().nullable(),
  defaultLocale: z.string(),
  pinnedVersionId: z.string().uuid().nullable(),
  requireCustomerAuth: z.boolean(),
  allowMultipleSubmissions: z.boolean(),
  maxResponses: z.number().int().nullable(),
  responseCount: z.number().int(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  redirectUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(distributionItemSchema),
  total: z.number().int(),
})

const createResponseSchema = z.object({ id: z.string().uuid() })
const errorSchema = z.object({ error: z.string() })

const requestBodySchema = distributionCreateCommandSchema.omit({
  tenantId: true,
  organizationId: true,
  formId: true,
})

function extractFormId(req: Request): string {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const formsIdx = segments.findIndex((segment) => segment === 'forms')
  return formsIdx >= 0 ? segments[formsIdx + 1] ?? '' : ''
}

function serializeDistribution(distribution: FormDistribution) {
  return {
    id: distribution.id,
    formId: distribution.formId,
    mode: distribution.mode,
    status: distribution.status,
    publicSlug: distribution.publicSlug ?? null,
    title: distribution.title ?? null,
    defaultLocale: distribution.defaultLocale,
    pinnedVersionId: distribution.pinnedVersionId ?? null,
    requireCustomerAuth: distribution.requireCustomerAuth,
    allowMultipleSubmissions: distribution.allowMultipleSubmissions,
    maxResponses: distribution.maxResponses ?? null,
    responseCount: distribution.responseCount,
    opensAt: distribution.opensAt ? distribution.opensAt.toISOString() : null,
    closesAt: distribution.closesAt ? distribution.closesAt.toISOString() : null,
    redirectUrl: distribution.redirectUrl ?? null,
    createdAt: distribution.createdAt.toISOString(),
    updatedAt: distribution.updatedAt.toISOString(),
  }
}

export async function GET(req: Request) {
  try {
    const { ctx, organizationId, tenantId } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const formId = extractFormId(req)
    if (!formId) return jsonError(400, 'forms.errors.invalid_id')

    const em = ctx.container.resolve('em') as EntityManager
    await findFormInScope(em, formId, tenantId, organizationId)

    const [distributions, total] = await em.findAndCount(
      FormDistribution,
      { formId, tenantId, organizationId, deletedAt: null },
      { orderBy: { createdAt: 'desc' } },
    )

    return NextResponse.json({
      items: distributions.map(serializeDistribution),
      total,
    })
  } catch (error) {
    return handleRouteError('distributions.GET', error)
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const formId = extractFormId(req)
    if (!formId) return jsonError(400, 'forms.errors.invalid_id')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsedBody = requestBodySchema.parse(body)
    const scoped = withScopedPayload({ ...parsedBody, formId }, ctx, translate)
    const input = distributionCreateCommandSchema.parse(scoped) satisfies FormDistributionCreateCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_DISTRIBUTION_RESOURCE_KIND,
      resourceId: 'new',
      operation: 'create',
      request: req,
      payload: scoped as Record<string, unknown>,
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<
          FormDistributionCreateCommandInput,
          { distributionId: string }
        >('forms.distribution.create', { input, ctx })
        const response = NextResponse.json({ id: result?.distributionId ?? null }, { status: 201 })
        return attachOperationMetadata(
          response,
          logEntry,
          FORM_DISTRIBUTION_RESOURCE_KIND,
          result?.distributionId ?? null,
        )
      },
    })
  } catch (error) {
    return handleRouteError('distributions.POST', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Manage form distributions',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List distributions',
      description: 'Returns all distributions for a form scoped to the authenticated organization.',
      responses: [{ status: 200, description: 'Distribution list', schema: listResponseSchema }],
      errors: [
        { status: 400, description: 'Organization context missing', schema: errorSchema },
        { status: 404, description: 'Form not found', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Create distribution',
      description:
        'Creates an open (public link) or personal (per-recipient invitations) distribution. Open distributions mint a public_slug.',
      requestBody: { contentType: 'application/json', schema: requestBodySchema },
      responses: [{ status: 201, description: 'Distribution created', schema: createResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 404, description: 'Form not found', schema: errorSchema },
      ],
    },
  },
}
