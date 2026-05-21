/**
 * Public runtime API — GET /api/forms/public/distributions/:slug
 *
 * Resolves an open-mode distribution by its public slug and returns the served
 * form context (schema / ui schema / field index) plus availability metadata.
 * Unauthenticated by design — the slug is the bearer of access. A closed,
 * expired, or response-capped distribution propagates a 410 GONE from the
 * DistributionService.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DistributionService } from '../../../../services/distribution-service'
import { mapDistributionError, serializeFormContext } from '../../../runtime-helpers'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  _req: NextRequest,
  context: { params: { slug: string } | Promise<{ slug: string }> },
) {
  const params = await Promise.resolve(context.params)
  const slug = String(params.slug)

  const container = await createRequestContainer()
  const service = container.resolve('formsDistributionService') as DistributionService

  try {
    const { distribution } = await service.resolveBySlug(slug)
    const formContext = await service.getFormContext({ distribution })
    return NextResponse.json({
      distribution_id: distribution.id,
      ...serializeFormContext({ ...formContext, distribution }),
      requires_customer_auth: distribution.requireCustomerAuth,
      default_locale: distribution.defaultLocale,
    })
  } catch (error) {
    return mapDistributionError(error)
  }
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const responseSchema = z.object({
  distribution_id: z.string().uuid(),
  form: z.object({
    key: z.string(),
    name: z.string(),
    defaultLocale: z.string(),
    supportedLocales: z.array(z.string()),
  }),
  schema: z.record(z.string(), z.unknown()),
  ui_schema: z.record(z.string(), z.unknown()),
  fieldIndex: z.record(z.string(), z.unknown()),
  completion: z.object({
    title: z.string().nullable(),
    message: z.string().nullable(),
  }),
  redirect_url: z.string().nullable(),
  requires_customer_auth: z.boolean(),
  default_locale: z.string(),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Resolve an open-link distribution',
  description: 'Returns the form context served by an open-mode distribution identified by its public slug.',
  tags: ['Forms Public Runtime'],
  responses: [{ status: 200, description: 'Distribution form context', schema: responseSchema }],
  errors: [
    { status: 404, description: 'Distribution or form not found', schema: errorSchema },
    { status: 410, description: 'Distribution closed, not yet open, or response cap reached', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public open-link distribution context',
  methods: { GET: getMethodDoc },
}
