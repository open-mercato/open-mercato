/**
 * Public runtime API — GET /api/forms/public/invitations/:token
 *
 * Resolves a personal-mode invitation by its raw token, marking it `opened`
 * on first resolve, and returns the served form context plus a lightweight,
 * PII-free invitation descriptor. A submitted / expired / revoked invitation
 * propagates a 410 GONE from the DistributionService.
 *
 * Recipient PII (`recipient_email` / `recipient_name`) is deliberately NOT
 * echoed in the response (R-2d-3).
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
  context: { params: { token: string } | Promise<{ token: string }> },
) {
  const params = await Promise.resolve(context.params)
  const token = String(params.token)

  const container = await createRequestContainer()
  const service = container.resolve('formsDistributionService') as DistributionService

  try {
    const { invitation, distribution } = await service.resolveByToken(token)
    const formContext = await service.getFormContext({ distribution })
    return NextResponse.json({
      distribution_id: distribution.id,
      ...serializeFormContext(formContext),
      requires_customer_auth: distribution.requireCustomerAuth,
      default_locale: distribution.defaultLocale,
      invitation: {
        id: invitation.id,
        status: invitation.status,
        locale: invitation.locale ?? null,
      },
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
  requires_customer_auth: z.boolean(),
  default_locale: z.string(),
  invitation: z.object({
    id: z.string().uuid(),
    status: z.string(),
    locale: z.string().nullable(),
  }),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Resolve a personal invitation',
  description: 'Returns the form context for a personal-mode invitation identified by its raw token, marking the invitation opened.',
  tags: ['Forms Public Runtime'],
  responses: [{ status: 200, description: 'Invitation form context', schema: responseSchema }],
  errors: [
    { status: 404, description: 'Invitation, distribution, or form not found', schema: errorSchema },
    { status: 410, description: 'Invitation submitted, expired, or revoked; distribution unavailable', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public personal-invitation context',
  methods: { GET: getMethodDoc },
}
