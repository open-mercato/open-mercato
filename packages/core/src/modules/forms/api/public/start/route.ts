/**
 * Public runtime API — POST /api/forms/public/start
 *
 * Begins an anonymous submission against an open-mode (slug) or personal-mode
 * (token) distribution and returns the submission view plus a short-lived
 * submission access token that authorizes subsequent autosave / submit.
 *
 * Distributions that require customer auth do NOT mint anonymous tokens — the
 * caller is told to fall back to the portal login (409). An optional CAPTCHA
 * hook (gated by `distribution.settings.captcha`) returns 422 when the token is
 * missing (`CAPTCHA_REQUIRED`) or fails provider verification (`CAPTCHA_FAILED`).
 * Rate-limited per client IP (R-2d-1).
 *
 * Real verification requires a configured provider:
 *   - `FORMS_CAPTCHA_PROVIDER` — `turnstile` (Cloudflare) | `recaptcha` (Google)
 *   - `FORMS_CAPTCHA_SECRET`   — the provider's secret key
 * When no provider is configured the verifier is a no-op: token *presence* is
 * still required (backward-compat for envs that toggled `settings.captcha`), but
 * the token is accepted without remote verification.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DistributionService } from '../../../services/distribution-service'
import type { FormInvitation, FormDistribution } from '../../../data/entities'
import {
  isCaptchaProviderConfigured,
  type CaptchaVerifier,
} from '../../../services/captcha-verifier'
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

function captchaRequired(distribution: FormDistribution): boolean {
  return Boolean(distribution.settings?.captcha)
}

type CaptchaGateResult = { ok: true } | { ok: false; error: 'CAPTCHA_REQUIRED' | 'CAPTCHA_FAILED' }

/**
 * Enforces the CAPTCHA gate for a distribution:
 *  - Not enabled ⇒ pass.
 *  - Enabled + provider configured ⇒ require a token, then verify it remotely.
 *    A missing token is `CAPTCHA_REQUIRED`; a failed verification is `CAPTCHA_FAILED`.
 *  - Enabled + no provider ⇒ require token presence only (backward-compat).
 */
async function enforceCaptcha(args: {
  distribution: FormDistribution
  token: string | undefined
  remoteIp: string
  verifier: CaptchaVerifier
}): Promise<CaptchaGateResult> {
  if (!captchaRequired(args.distribution)) return { ok: true }
  if (!args.token) return { ok: false, error: 'CAPTCHA_REQUIRED' }
  if (!isCaptchaProviderConfigured(process.env)) return { ok: true }
  const result = await args.verifier.verify({ token: args.token, remoteIp: args.remoteIp })
  return result.success ? { ok: true } : { ok: false, error: 'CAPTCHA_FAILED' }
}

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req)
  const limited = await enforcePublicRateLimit(`forms:public:start:${clientIp}`)
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
  const captchaVerifier = container.resolve('formsCaptchaVerifier') as CaptchaVerifier

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

    const captchaGate = await enforceCaptcha({
      distribution,
      token: parsed.data.captchaToken,
      remoteIp: clientIp,
      verifier: captchaVerifier,
    })
    if (!captchaGate.ok) {
      const message =
        captchaGate.error === 'CAPTCHA_FAILED'
          ? 'CAPTCHA verification failed.'
          : 'A CAPTCHA token is required to start this form.'
      return NextResponse.json({ error: captchaGate.error, message }, { status: 422 })
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
    { status: 422, description: 'Validation failed, CAPTCHA required, or CAPTCHA verification failed', schema: errorSchema },
    { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Begin anonymous submission',
  methods: { POST: postMethodDoc },
}
