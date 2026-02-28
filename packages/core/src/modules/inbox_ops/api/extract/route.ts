import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { InboxEmail } from '../../data/entities'
import { emitInboxOpsEvent } from '../../events'
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

    const email = ctx.em.create(InboxEmail, {
      forwardedByAddress: ctx.userId,
      forwardedByName: null,
      toAddress: 'text-extract',
      subject: title || 'Text extraction',
      cleanedText: truncatedText,
      rawText: truncatedText,
      receivedAt: new Date(),
      status: 'received' as const,
      isActive: true,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      metadata: {
        ...inputMetadata,
        source: 'text_extract',
        submittedByUserId: ctx.userId,
      },
    })

    ctx.em.persist(email)
    await ctx.em.flush()

    try {
      await emitInboxOpsEvent('inbox_ops.email.received', {
        emailId: email.id,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        forwardedByAddress: ctx.userId,
        subject: title || 'Text extraction',
      })
    } catch (eventError) {
      console.error('[inbox_ops:extract] Failed to emit email.received event:', eventError)
    }

    return NextResponse.json({ ok: true, emailId: email.id })
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
      description: 'Creates an InboxEmail record from raw text and triggers the extraction pipeline. The extraction runs asynchronously.',
      responses: [
        { status: 200, description: 'Extraction queued successfully' },
        { status: 400, description: 'Invalid request body' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
