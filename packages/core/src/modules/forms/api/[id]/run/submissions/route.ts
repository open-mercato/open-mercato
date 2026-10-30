/**
 * In-app runner — POST /api/forms/:id/run/submissions.
 *
 * Authenticated and tenant-scoped, for the same reason as the sibling
 * `run/context` route: it is addressed by FORM id rather than by a distribution
 * slug or invitation token, so it carries no capability a tenant deliberately
 * handed out, and served anonymously it let any caller holding a form UUID
 * confirm that form's existence and drive the logic evaluator against another
 * tenant's schema — outside the CAPTCHA and rate limiter that
 * `/api/forms/public/*` enforces.
 *
 * @deprecated Phase 2d superseded this validation-only stub with the
 * persisting public runtime flow under `/api/forms/public/*`
 * (`POST /api/forms/public/start` → `PATCH /api/forms/public/submissions/:id`
 * → `POST /api/forms/public/submissions/:id/submit`). This route is retained as
 * a one-version backward-compatibility bridge per the root deprecation protocol
 * — it STILL only re-runs the tamper evaluator and returns
 * `{ accepted, reachedEndingKey }` without persisting — and will be removed in a
 * later release. New clients MUST use the `/api/forms/public/*` flow.
 *
 * Accepts the runner's `{ formVersionId, answers, hidden, endingKey, locale }`
 * payload, re-runs the evaluator against `(answers, hidden)` server-side,
 * and asserts that the claimed ending is the one the evaluator reaches
 * (R-3 tamper-resistance).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/core'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Form, FormVersion } from '../../../../data/entities'
import { checkSubmissionTamper } from '../../../../runner/tamper-check'
import { buildFormsRouteContext, jsonError } from '../../../helpers'

const bodySchema = z.object({
  formVersionId: z.string().uuid(),
  answers: z.record(z.string(), z.unknown()),
  hidden: z.record(z.string(), z.unknown()),
  endingKey: z.string().nullable(),
  locale: z.string().min(2),
})

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(
  req: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const params = await Promise.resolve(context.params)
  const formId = String(params.id)

  let payload: z.infer<typeof bodySchema>
  try {
    payload = bodySchema.parse(await req.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body.'
    return NextResponse.json({ error: 'INVALID_BODY', message }, { status: 400 })
  }

  let scoped: Awaited<ReturnType<typeof buildFormsRouteContext>>
  try {
    scoped = await buildFormsRouteContext(req)
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    throw error
  }
  const { ctx, organizationId, tenantId } = scoped
  if (!organizationId || !tenantId) {
    return jsonError(400, 'forms.errors.organization_required')
  }

  const em = ctx.container.resolve('em') as EntityManager

  const form = await em.findOne(Form, { id: formId, tenantId, organizationId, deletedAt: null })
  if (!form) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Form not found.' }, { status: 404 })
  }
  if (form.status !== 'active') {
    return NextResponse.json({ error: 'FORM_INACTIVE', message: 'Form is not active.' }, { status: 422 })
  }
  const formVersion = await em.findOne(FormVersion, {
    id: payload.formVersionId,
    organizationId: form.organizationId,
    tenantId: form.tenantId,
  })
  if (!formVersion) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Form version not found.' },
      { status: 404 },
    )
  }

  const result = checkSubmissionTamper({
    schema: formVersion.schema as Record<string, unknown>,
    answers: payload.answers,
    hidden: payload.hidden,
    claimedEndingKey: payload.endingKey,
    locale: payload.locale,
  })
  if (!result.ok) {
    return NextResponse.json(
      {
        error: 'TAMPER_DETECTED',
        message: 'Claimed ending does not match the evaluator outcome.',
        details: { reason: result.reason, reachedEndingKey: result.reachedEndingKey ?? null },
      },
      { status: 422 },
    )
  }

  return NextResponse.json({
    accepted: true,
    reachedEndingKey: result.reachedEndingKey ?? null,
  })
}

const responseSchema = z.object({
  accepted: z.boolean(),
  reachedEndingKey: z.string().nullable(),
})

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Submit answers via the in-app runner with tamper validation.',
  description: 'Server-side re-runs the evaluator against the posted answers and asserts the claimed ending is reachable. 422 on mismatch. Authenticated and scoped to the caller\'s tenant and organization; deprecated in favour of POST /api/forms/public/submissions/:id/submit.',
  tags: ['Forms Runtime'],
  responses: [{ status: 200, description: 'Submission accepted (validation only — persistence in phase 1d).', schema: responseSchema }],
  errors: [
    { status: 400, description: 'Malformed body, or missing tenant/organization context', schema: errorSchema },
    { status: 401, description: 'Unauthenticated', schema: errorSchema },
    { status: 404, description: 'Form or version not found', schema: errorSchema },
    { status: 422, description: 'Form inactive or tamper detected', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'In-app form submission',
  methods: { POST: postMethodDoc },
}
