/**
 * Public runner — POST /api/forms/:id/run/submissions.
 *
 * Accepts the runner's `{ formVersionId, answers, hidden, endingKey, locale }`
 * payload, re-runs the evaluator against `(answers, hidden)` server-side,
 * and asserts that the claimed ending is the one the evaluator reaches
 * (R-3 tamper-resistance). Persistence is deferred to phase 1d's
 * authenticated submission flow — this minimal route is currently
 * validation-only and returns `{ accepted: true, reachedEndingKey }`
 * so 1d can wire the persistence path without breaking the runner.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { Form, FormVersion } from '../../../../data/entities'
import { checkSubmissionTamper } from '../../../../runner/tamper-check'

const bodySchema = z.object({
  formVersionId: z.string().uuid(),
  answers: z.record(z.string(), z.unknown()),
  hidden: z.record(z.string(), z.unknown()),
  endingKey: z.string().nullable(),
  locale: z.string().min(2),
})

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(
  req: NextRequest,
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

  const container = await createRequestContainer()
  const emFactory = container.resolve('emFactory') as () => EntityManager
  const em = emFactory()

  const form = await em.findOne(Form, { id: formId, deletedAt: null })
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
  summary: 'Submit answers via the public runner with tamper validation.',
  description: 'Server-side re-runs the evaluator against the posted answers and asserts the claimed ending is reachable. 422 on mismatch.',
  tags: ['Forms Runtime'],
  responses: [{ status: 200, description: 'Submission accepted (validation only — persistence in phase 1d).', schema: responseSchema }],
  errors: [
    { status: 400, description: 'Malformed body', schema: errorSchema },
    { status: 404, description: 'Form or version not found', schema: errorSchema },
    { status: 422, description: 'Form inactive or tamper detected', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public form submission',
  methods: { POST: postMethodDoc },
}
