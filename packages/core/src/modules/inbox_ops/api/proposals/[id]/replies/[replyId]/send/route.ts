import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposalAction, InboxEmail } from '../../../../../../data/entities'
import { draftReplyPayloadSchema } from '../../../../../../data/validators'
import { emitInboxOpsEvent } from '../../../../../../events'
import {
  resolveRequestContext,
  resolveProposal,
  extractPathSegment,
  handleRouteError,
  isErrorResponse,
} from '../../../../../routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.replies.send'] },
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Email service not configured' }, { status: 503 })
    }

    const emailDisabled =
      parseBooleanWithDefault(process.env.OM_DISABLE_EMAIL_DELIVERY, false) ||
      parseBooleanWithDefault(process.env.OM_TEST_MODE, false)
    if (emailDisabled) {
      return NextResponse.json({ error: 'Email delivery is disabled' }, { status: 503 })
    }

    const ctx = await resolveRequestContext(req)
    const url = new URL(req.url)
    const proposal = await resolveProposal(url, ctx)
    if (isErrorResponse(proposal)) return proposal

    const replyId = extractPathSegment(url, 'replies')
    if (!replyId) {
      return NextResponse.json({ error: 'Missing reply ID' }, { status: 400 })
    }

    const action = await findOneWithDecryption(
      ctx.em,
      InboxProposalAction,
      {
        id: replyId,
        proposalId: proposal.id,
        actionType: 'draft_reply',
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      undefined,
      ctx.scope,
    )

    if (!action) {
      return NextResponse.json({ error: 'Reply action not found' }, { status: 404 })
    }

    if (action.status !== 'executed') {
      return NextResponse.json(
        { error: `Cannot send reply — action must be accepted first (current status: "${action.status}")` },
        { status: 409 },
      )
    }

    const email = await findOneWithDecryption(
      ctx.em,
      InboxEmail,
      { id: proposal.inboxEmailId, deletedAt: null },
      undefined,
      ctx.scope,
    )

    const payloadResult = draftReplyPayloadSchema.safeParse(action.payload)
    if (!payloadResult.success) {
      return NextResponse.json({ error: 'Reply payload missing required fields (to, subject, body)' }, { status: 400 })
    }
    const { to: toAddress, subject, body, inReplyToMessageId, references: payloadReferences } = payloadResult.data

    const fromAddress = process.env.EMAIL_FROM || `inbox@${process.env.INBOX_OPS_DOMAIN || 'inbox.mercato.local'}`

    const headers: Record<string, string> = {}
    const inReplyTo = inReplyToMessageId || email?.messageId
    if (inReplyTo) {
      headers['In-Reply-To'] = inReplyTo
    }
    const references = payloadReferences || (email?.emailReferences as string[])
    if (references && references.length > 0) {
      headers['References'] = references.join(' ')
    }

    const resend = new Resend(apiKey)
    const { data: sendData, error: sendError } = await resend.emails.send({
      to: toAddress,
      from: fromAddress,
      subject,
      text: body,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    })

    if (sendError) {
      const errorMessage = sendError.message || 'Unknown error'
      return NextResponse.json({ error: `Failed to send email: ${errorMessage}` }, { status: 502 })
    }

    const sentMessageId = sendData?.id || null

    action.metadata = {
      ...(action.metadata && typeof action.metadata === 'object' ? action.metadata : {}),
      replySentAt: new Date().toISOString(),
      sentMessageId,
    }
    await ctx.em.flush()

    try {
      await emitInboxOpsEvent('inbox_ops.reply.sent', {
        proposalId: proposal.id,
        actionId: replyId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        toAddress,
        sentMessageId,
      })
    } catch (eventError) {
      console.error('[inbox_ops:reply:send] Failed to emit event:', eventError)
    }

    return NextResponse.json({ ok: true, sentMessageId })
  } catch (err) {
    return handleRouteError(err, 'send reply')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Send draft reply',
  methods: {
    POST: {
      summary: 'Send a draft reply email via the configured email provider',
      description: 'Sends the draft_reply action payload as an email. Sets In-Reply-To and References headers for threading.',
      responses: [
        { status: 200, description: 'Reply sent successfully' },
        { status: 400, description: 'Missing required payload fields' },
        { status: 404, description: 'Reply action not found' },
        { status: 409, description: 'Action in invalid state for sending' },
        { status: 502, description: 'Email delivery failed' },
        { status: 503, description: 'Email service not configured or disabled' },
      ],
    },
  },
}
