import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { FormDistribution } from '../../../data/entities'
import {
  distributionCloseCommandSchema,
  distributionUpdateCommandSchema,
  type FormDistributionCloseCommandInput,
  type FormDistributionUpdateCommandInput,
} from '../../../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from '../../helpers'
import { FORM_DISTRIBUTION_RESOURCE_KIND } from '../../../commands/distribution'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.distribute'] },
  PATCH: { requireAuth: true, requireFeatures: ['forms.distribute'] },
}

const distributionSchema = z.object({
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
  settings: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const patchResponseSchema = z.object({ id: z.string().uuid() })
const errorSchema = z.object({ error: z.string() })

const patchBodySchema = distributionUpdateCommandSchema.omit({
  tenantId: true,
  organizationId: true,
  distributionId: true,
})

function extractDistributionId(req: Request): string {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const idx = segments.findIndex((segment) => segment === 'distributions')
  return idx >= 0 ? segments[idx + 1] ?? '' : ''
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
    settings: distribution.settings ?? null,
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
    const distributionId = extractDistributionId(req)
    if (!distributionId) return jsonError(400, 'forms.errors.invalid_id')

    const em = ctx.container.resolve('em') as EntityManager
    const distribution = await em.findOne(FormDistribution, {
      id: distributionId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!distribution) {
      throw new CrudHttpError(404, { error: 'forms.errors.distribution_not_found' })
    }

    return NextResponse.json(serializeDistribution(distribution))
  } catch (error) {
    return handleRouteError('distributions.detail.GET', error)
  }
}

export async function PATCH(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const distributionId = extractDistributionId(req)
    if (!distributionId) return jsonError(400, 'forms.errors.invalid_id')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsedBody = patchBodySchema.parse(body)

    // A PATCH carrying only { status: 'closed' } routes to the close command;
    // anything else mutates via the update command (which also handles close).
    const isCloseOnly =
      parsedBody.status === 'closed' && Object.keys(parsedBody).filter((key) => key !== 'status').length === 0

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_DISTRIBUTION_RESOURCE_KIND,
      resourceId: distributionId,
      operation: 'update',
      request: req,
      payload: { ...parsedBody, distributionId } as Record<string, unknown>,
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        if (isCloseOnly) {
          const scoped = withScopedPayload({ distributionId }, ctx, translate)
          const input = distributionCloseCommandSchema.parse(scoped) satisfies FormDistributionCloseCommandInput
          const { result, logEntry } = await commandBus.execute<
            FormDistributionCloseCommandInput,
            { distributionId: string }
          >('forms.distribution.close', { input, ctx })
          const response = NextResponse.json({ id: result?.distributionId ?? distributionId })
          return attachOperationMetadata(
            response,
            logEntry,
            FORM_DISTRIBUTION_RESOURCE_KIND,
            result?.distributionId ?? distributionId,
          )
        }
        const scoped = withScopedPayload({ ...parsedBody, distributionId }, ctx, translate)
        const input = distributionUpdateCommandSchema.parse(scoped) satisfies FormDistributionUpdateCommandInput
        const { result, logEntry } = await commandBus.execute<
          FormDistributionUpdateCommandInput,
          { distributionId: string }
        >('forms.distribution.update', { input, ctx })
        const response = NextResponse.json({ id: result?.distributionId ?? distributionId })
        return attachOperationMetadata(
          response,
          logEntry,
          FORM_DISTRIBUTION_RESOURCE_KIND,
          result?.distributionId ?? distributionId,
        )
      },
    })
  } catch (error) {
    return handleRouteError('distributions.detail.PATCH', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Read or update a distribution',
  pathParams: z.object({ distributionId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get distribution',
      description: 'Returns a single distribution scoped to the authenticated organization.',
      responses: [{ status: 200, description: 'Distribution', schema: distributionSchema }],
      errors: [{ status: 404, description: 'Distribution not found', schema: errorSchema }],
    },
    PATCH: {
      summary: 'Update or close distribution',
      description:
        'Updates mutable distribution fields. A body of { "status": "closed" } closes the distribution and emits forms.distribution.closed.',
      requestBody: { contentType: 'application/json', schema: patchBodySchema },
      responses: [{ status: 200, description: 'Distribution updated', schema: patchResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 404, description: 'Distribution not found', schema: errorSchema },
      ],
    },
  },
}
