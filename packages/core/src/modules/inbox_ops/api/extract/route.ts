import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { emitSourceSubmissionRequested } from '../../lib/source-submission-request'
import { resolveRequestContext, handleRouteError } from '../routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

const extractRequestSchema = z.object({
  text: z.string().min(1, 'Text is required').max(100_000, 'Text exceeds maximum length'),
  title: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = extractRequestSchema.safeParse(body)
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      return NextResponse.json({ error: errors }, { status: 400 })
    }

    const { text, title, metadata: inputMetadata } = parsed.data

    const maxTextSize = parseInt(process.env.INBOX_OPS_MAX_TEXT_SIZE || '204800', 10)
    const truncatedText = text.slice(0, maxTextSize)

    const sourceSubmissionId = randomUUID()
    await emitSourceSubmissionRequested({
      submissionId: sourceSubmissionId,
      descriptor: {
        sourceEntityType: 'inbox_ops:source_submission',
        sourceEntityId: sourceSubmissionId,
        sourceVersion: sourceSubmissionId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        requestedByUserId: ctx.userId,
      },
      metadata: {
        ...inputMetadata,
        source: 'text_extract',
        submittedByUserId: ctx.userId,
      },
      initialNormalizedInput: {
        sourceEntityType: 'inbox_ops:source_submission',
        sourceEntityId: sourceSubmissionId,
        sourceVersion: sourceSubmissionId,
        title: title || undefined,
        body: truncatedText,
        bodyFormat: 'text',
        participants: [],
        capabilities: {
          canDraftReply: false,
          canUseTimelineContext: false,
        },
        sourceMetadata: {
          source: 'text_extract',
          submittedByUserId: ctx.userId,
        },
      },
      initialSourceSnapshot: {
        sourceKind: 'manual text',
        title: title || null,
      },
    })

    return NextResponse.json({
      ok: true,
      sourceSubmissionId,
      emailId: sourceSubmissionId,
    })
  } catch (err) {
    return handleRouteError(err, 'extract text')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Extract actions from raw text',
  methods: {
    POST: {
      summary: 'Submit raw text for LLM extraction',
      description: 'Creates an internal source submission from raw text and triggers the extraction pipeline. The extraction runs asynchronously.',
      responses: [
        { status: 200, description: 'Extraction queued successfully' },
        { status: 400, description: 'Invalid request body' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
