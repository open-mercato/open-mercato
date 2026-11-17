/**
 * Runtime API — GET /api/form-submissions/:id/resume-token
 *
 * Issues a signed cross-device resume token for the calling user on the
 * supplied submission. Returns 403 if the caller has no active actor row.
 *
 * Token format (compact, no JWT to avoid header cookie collisions):
 *   `${submissionId}.${userId}.${exp}.${hmac}`
 * where `hmac = HMAC-SHA256(secret, "${submissionId}|${userId}|${exp}")`.
 *
 * The validator/consumer for this token lives in the renderer (phase 1d).
 * `verifyResumeToken` is exported here to keep both sides honest.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { FormSubmission, FormSubmissionActor } from '../../../../data/entities'

const DEFAULT_TTL_S = (() => {
  const raw = process.env.FORMS_RESUME_TOKEN_TTL_S
  if (!raw) return 3600
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600
})()

function getSecret(): string {
  const secret = process.env.FORMS_RESUME_TOKEN_SECRET ?? process.env.JWT_SECRET ?? ''
  if (!secret) {
    throw new Error('FORMS_RESUME_TOKEN_SECRET (or JWT_SECRET fallback) must be set.')
  }
  return secret
}

export function buildResumeToken(args: { submissionId: string; userId: string; expiresAtSeconds: number }): string {
  const payload = `${args.submissionId}|${args.userId}|${args.expiresAtSeconds}`
  const hmac = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${args.submissionId}.${args.userId}.${args.expiresAtSeconds}.${hmac}`
}

export function verifyResumeToken(token: string): {
  ok: boolean
  submissionId?: string
  userId?: string
  reason?: string
} {
  const parts = token.split('.')
  if (parts.length !== 4) return { ok: false, reason: 'malformed' }
  const [submissionId, userId, expRaw, hmac] = parts
  const exp = Number.parseInt(expRaw, 10)
  if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed_exp' }
  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' }
  const expected = createHmac('sha256', getSecret())
    .update(`${submissionId}|${userId}|${exp}`)
    .digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(hmac, 'hex')
  if (expectedBuf.length !== actualBuf.length) return { ok: false, reason: 'signature' }
  if (!timingSafeEqual(expectedBuf, actualBuf)) return { ok: false, reason: 'signature' }
  return { ok: true, submissionId, userId }
}

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const submission = await em.findOne(FormSubmission, {
    id: submissionId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!submission) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const actor = await em.findOne(FormSubmissionActor, {
    submissionId: submission.id,
    organizationId: auth.orgId,
    userId: auth.sub,
    revokedAt: null,
    deletedAt: null,
  })
  if (!actor) {
    return NextResponse.json({ error: 'NO_ACTOR' }, { status: 403 })
  }

  const exp = Math.floor(Date.now() / 1000) + DEFAULT_TTL_S
  let token: string
  try {
    token = buildResumeToken({ submissionId, userId: auth.sub, expiresAtSeconds: exp })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 })
  }
  return NextResponse.json({ token, expiresAt: new Date(exp * 1000).toISOString() })
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

const responseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Issue a resume token for a submission',
  description: 'Returns a signed token that another device can use to resume the submission. TTL governed by FORMS_RESUME_TOKEN_TTL_S.',
  tags: ['Forms Runtime'],
  responses: [{ status: 200, description: 'Resume token issued', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'No active actor row for user', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Resume token issuance',
  methods: { GET: getMethodDoc },
}
