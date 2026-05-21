/**
 * Public runtime API — POST /api/forms/public/start
 *
 * Begins an anonymous submission against an open-mode (slug) or personal-mode
 * (token) distribution and returns the submission view plus a short-lived
 * submission access token that authorizes subsequent autosave / submit.
 *
 * Distributions that require customer auth do NOT mint anonymous tokens — the
 * caller is told to fall back to the portal login (409). An optional CAPTCHA
 * hook (gated by `distribution.settings.captcha`) returns 422 when no token is
 * supplied. Rate-limited per client IP (R-2d-1).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DistributionService } from '../../../services/distribution-service'
import type { FormInvitation, FormDistribution } from '../../../data/entities'
import { publicStartInputSchema } from '../../../data/validators'
import {
  mapDistributionError,
  readJsonBody,
  serializeRevision,
  serializeSubmission,
} from '../../runtime-helpers'
import { enforcePublicRateLimit, getClientIp } from '../rate-limit'

export const metadata = {
  POST: { requireAuth: false },
}

/**
 * TODO(forms-2d): wire a real CAPTCHA verification provider. Until then the
 * presence of a token is treated as success — the verification surface is in
 * place so the public page can pass a token without changing this contract.
 */
function verifyCaptcha(captchaToken: string | undefined): boolean {
  return Boolean(captchaToken)
}

function captchaRequired(distribution: FormDistribution): boolean {
  return Boolean(distribution.settings?.captcha)
}

export async function POST(req: NextRequest) {
  const limited = await enforcePublicRateLimit(`forms:public:start:${getClientIp(req)}`)
  if (limited) return limited

  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch (error) {
    return mapDistributionError(error)
  }
  const parsed = publicStartInputSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const service = container.resolve('formsDistributionService') as DistributionService

  try {
    let distribution: FormDistribution
    let invitation: FormInvitation | undefined
    if (parsed.data.token) {
      const resolved = await service.resolveByToken(parsed.data.token)
      distribution = resolved.distribution
      invitation = resolved.invitation
    } else {
      const resolved = await service.resolveBySlug(parsed.data.slug as string)
      distribution = resolved.distribution
    }

    if (distribution.requireCustomerAuth) {
      return NextResponse.json(
        { error: 'CUSTOMER_AUTH_REQUIRED', message: 'This form requires a signed-in customer.' },
        { status: 409 },
      )
    }

    if (captchaRequired(distribution) && !verifyCaptcha(parsed.data.captchaToken)) {
      return NextResponse.json(
        { error: 'CAPTCHA_REQUIRED', message: 'A CAPTCHA token is required to start this form.' },
        { status: 422 },
      )
    }

    const result = await service.beginAnonymous({
      distribution,
      invitation,
      locale: parsed.data.locale ?? null,
    })

    return NextResponse.json(
      {
        submission: serializeSubmission(result.view.submission),
        revision: serializeRevision(result.view.revision),
        decoded_data: result.view.decodedData,
        access_token: result.accessToken,
        expires_at: result.expiresAt,
      },
      { status: 201 },
    )
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
  submission: z.record(z.string(), z.unknown()),
  revision: z.record(z.string(), z.unknown()),
  decoded_data: z.record(z.string(), z.unknown()),
  access_token: z.string(),
  expires_at: z.string(),
})

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Begin an anonymous submission',
  description: 'Resolves a distribution by slug or token and bootstraps an anonymous submission, returning a submission access token.',
  tags: ['Forms Public Runtime'],
  requestBody: { schema: publicStartInputSchema },
  responses: [{ status: 201, description: 'Submission started', schema: responseSchema }],
  errors: [
    { status: 404, description: 'Distribution, invitation, or form not found', schema: errorSchema },
    { status: 409, description: 'Distribution requires customer authentication', schema: errorSchema },
    { status: 410, description: 'Distribution / invitation unavailable', schema: errorSchema },
    { status: 422, description: 'Validation failed or CAPTCHA required', schema: errorSchema },
    { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Begin anonymous submission',
  methods: { POST: postMethodDoc },
}
