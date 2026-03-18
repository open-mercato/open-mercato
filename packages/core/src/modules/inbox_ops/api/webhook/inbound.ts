import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { Webhook } from 'svix'
import { Resend } from 'resend'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxSettings, InboxEmail } from '../../data/entities'
import { parseInboundEmail } from '../../lib/emailParser'
import { checkRateLimit } from '../../lib/rateLimiter'
import { emitInboxOpsEvent } from '../../events'

export const metadata = {
  POST: { requireAuth: false },
}

const MAX_PAYLOAD_SIZE = 2 * 1024 * 1024 // 2MB
const REPLAY_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

function verifyHmacSignature(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string,
): boolean {
  if (!signature || !timestamp || !secret) return false

  const timestampMs = parseInt(timestamp, 10) * 1000
  if (isNaN(timestampMs)) return false
  if (Math.abs(Date.now() - timestampMs) > REPLAY_WINDOW_MS) return false

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  const received = signature.startsWith('sha256=')
    ? signature.slice('sha256='.length)
    : signature

  try {
    if (received.length !== expected.length) return false
    return timingSafeEqual(
      Buffer.from(received, 'hex'),
      Buffer.from(expected, 'hex'),
    )
  } catch {
    return false
  }
}

function verifySvixSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  try {
    const wh = new Webhook(secret)
    wh.verify(rawBody, {
      'svix-id': headers['svix-id'],
      'svix-timestamp': headers['svix-timestamp'],
      'svix-signature': headers['svix-signature'],
    })
    return true
  } catch {
    return false
  }
}

async function fetchResendEmail(emailId: string): Promise<{
  from?: string
  to?: string[]
  subject?: string
  text?: string
  html?: string
  messageId?: string
  replyTo?: string
  inReplyTo?: string
  references?: string[]
}> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is required to fetch Resend inbound emails')

  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.receiving.get(emailId)
  if (error || !data) {
    throw new Error(`Failed to fetch Resend email ${emailId}: ${error?.message || 'unknown error'}`)
  }

  return {
    from: data.from,
    to: data.to,
    subject: data.subject,
    text: data.text ?? undefined,
    html: data.html ?? undefined,
    messageId: data.message_id,
    replyTo: data.reply_to?.[0] ?? undefined,
    inReplyTo: data.headers?.['in-reply-to'] ?? undefined,
    references: data.headers?.['references']?.split(/\s+/).filter(Boolean),
  }
}

type VerifiedPayload =
  | { kind: 'custom'; payload: Record<string, unknown> }
  | { kind: 'resend'; emailFields: Awaited<ReturnType<typeof fetchResendEmail>>; to: string[] }

async function verifyAndParse(req: Request, rawBody: string): Promise<
  | { ok: true; data: VerifiedPayload }
  | { ok: false; response: NextResponse }
> {
  const customSig = req.headers.get('x-webhook-signature')
  const svixId = req.headers.get('svix-id')

  if (customSig) {
    const webhookSecret = process.env.INBOX_OPS_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('[inbox_ops:webhook] INBOX_OPS_WEBHOOK_SECRET not configured')
      return { ok: false, response: NextResponse.json({ error: 'Service unavailable' }, { status: 503 }) }
    }
    const timestamp = req.headers.get('x-webhook-timestamp') || ''
    if (!verifyHmacSignature(rawBody, customSig, timestamp, webhookSecret)) {
      return { ok: false, response: NextResponse.json({ error: 'Invalid signature' }, { status: 400 }) }
    }
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return { ok: false, response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    }
    return { ok: true, data: { kind: 'custom', payload } }
  }

  if (svixId) {
    const signingSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET
    if (!signingSecret) {
      console.error('[inbox_ops:webhook] RESEND_WEBHOOK_SIGNING_SECRET not configured')
      return { ok: false, response: NextResponse.json({ error: 'Service unavailable' }, { status: 503 }) }
    }
    const headers: Record<string, string> = {
      'svix-id': svixId,
      'svix-timestamp': req.headers.get('svix-timestamp') || '',
      'svix-signature': req.headers.get('svix-signature') || '',
    }
    if (!verifySvixSignature(rawBody, headers, signingSecret)) {
      return { ok: false, response: NextResponse.json({ error: 'Invalid signature' }, { status: 400 }) }
    }
    let envelope: { type?: string; data?: { email_id?: string; from?: string; to?: string[] } }
    try {
      envelope = JSON.parse(rawBody)
    } catch {
      return { ok: false, response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    }
    if (envelope.type !== 'email.received') {
      return { ok: false, response: NextResponse.json({ ok: true }) }
    }
    const emailId = envelope.data?.email_id
    if (!emailId) {
      return { ok: false, response: NextResponse.json({ error: 'Missing email_id in Resend payload' }, { status: 400 }) }
    }
    const emailFields = await fetchResendEmail(emailId)
    const to = emailFields.to || envelope.data?.to || []
    return { ok: true, data: { kind: 'resend', emailFields, to } }
  }

  return { ok: false, response: NextResponse.json({ error: 'Missing signature headers' }, { status: 400 }) }
}

export async function POST(req: Request) {
  const hasCustomSecret = Boolean(process.env.INBOX_OPS_WEBHOOK_SECRET)
  const hasResendSecret = Boolean(process.env.RESEND_WEBHOOK_SIGNING_SECRET)
  if (!hasCustomSecret && !hasResendSecret) {
    console.error('[inbox_ops:webhook] Neither INBOX_OPS_WEBHOOK_SECRET nor RESEND_WEBHOOK_SIGNING_SECRET is configured')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }

  const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
  if (contentLength > MAX_PAYLOAD_SIZE) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  if (rawBody.length > MAX_PAYLOAD_SIZE) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  const verified = await verifyAndParse(req, rawBody)
  if (!verified.ok) {
    return verified.response
  }

  let toAddress: string | null
  let emailInput: Parameters<typeof parseInboundEmail>[0]

  if (verified.data.kind === 'custom') {
    const payload = verified.data.payload
    toAddress = extractToAddress(payload)
    emailInput = {
      from: payload.from as string | undefined,
      to: payload.to as string | string[] | undefined,
      subject: payload.subject as string | undefined,
      text: payload.text as string | undefined,
      html: payload.html as string | undefined,
      messageId: payload.messageId as string | undefined,
      replyTo: payload.replyTo as string | undefined,
      inReplyTo: payload.inReplyTo as string | undefined,
      references: payload.references as string | string[] | undefined,
    }
  } else {
    const { emailFields, to } = verified.data
    toAddress = to.length > 0 ? to[0].toLowerCase() : null
    emailInput = {
      from: emailFields.from,
      to: emailFields.to,
      subject: emailFields.subject,
      text: emailFields.text,
      html: emailFields.html,
      messageId: emailFields.messageId,
      replyTo: emailFields.replyTo,
      inReplyTo: emailFields.inReplyTo,
      references: emailFields.references,
    }
  }

  if (!toAddress) {
    return NextResponse.json({ error: 'Missing recipient address' }, { status: 400 })
  }

  const container = await createRequestContainer()

  let cache: CacheStrategy | null = null
  try {
    cache = container.resolve('cache') as CacheStrategy
  } catch {
    // Cache not available — proceed without rate limiting
  }

  const rateCheck = await checkRateLimit(cache, `webhook:${toAddress}`)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: rateCheck.retryAfterSeconds
          ? { 'Retry-After': String(rateCheck.retryAfterSeconds) }
          : undefined,
      },
    )
  }
  const em = (container.resolve('em') as EntityManager).fork()

  const settings = await findOneWithDecryption(
    em,
    InboxSettings,
    {
      inboxAddress: toAddress.toLowerCase(),
      isActive: true,
      deletedAt: null,
    },
  )

  if (!settings) {
    return NextResponse.json({ ok: true })
  }

  const parsed = parseInboundEmail(emailInput)

  const isDuplicate = await checkDuplicate(em, settings, parsed.messageId, parsed.contentHash)
  if (isDuplicate) {
    try {
      await emitInboxOpsEvent('inbox_ops.email.deduplicated', {
        tenantId: settings.tenantId,
        organizationId: settings.organizationId,
        toAddress,
      })
    } catch (eventError) {
      console.error('[inbox_ops:webhook] Failed to emit deduplicated event:', eventError)
    }
    return NextResponse.json({ ok: true })
  }

  const maxTextSize = parseInt(process.env.INBOX_OPS_MAX_TEXT_SIZE || '204800', 10)
  const cleanedText = parsed.cleanedText.slice(0, maxTextSize)

  const email = em.create(InboxEmail, {
    messageId: parsed.messageId,
    contentHash: parsed.contentHash,
    forwardedByAddress: parsed.from.email,
    forwardedByName: parsed.from.name || null,
    toAddress,
    subject: parsed.subject,
    replyTo: parsed.replyTo,
    inReplyTo: parsed.inReplyTo,
    emailReferences: parsed.references,
    rawText: parsed.rawText,
    rawHtml: parsed.rawHtml,
    cleanedText,
    threadMessages: parsed.threadMessages,
    detectedLanguage: parsed.detectedLanguage,
    receivedAt: new Date(),
    status: 'received' as const,
    isActive: true,
    organizationId: settings.organizationId,
    tenantId: settings.tenantId,
  })

  em.persist(email)
  await em.flush()

  try {
    await emitInboxOpsEvent('inbox_ops.email.received', {
      emailId: email.id,
      tenantId: settings.tenantId,
      organizationId: settings.organizationId,
      forwardedByAddress: parsed.from.email,
      subject: parsed.subject,
    })
  } catch (eventError) {
    console.error('[inbox_ops:webhook] Failed to emit email.received event:', eventError)
  }

  return NextResponse.json({ ok: true })
}

function extractToAddress(payload: Record<string, unknown>): string | null {
  const to = payload.to
  if (typeof to === 'string') {
    const match = to.match(/<([^>]+)>/)
    return match ? match[1].toLowerCase() : to.trim().toLowerCase()
  }
  if (Array.isArray(to) && to.length > 0) {
    const first = to[0]
    if (typeof first === 'string') {
      const match = first.match(/<([^>]+)>/)
      return match ? match[1].toLowerCase() : first.trim().toLowerCase()
    }
  }
  return null
}

async function checkDuplicate(
  em: EntityManager,
  settings: InboxSettings,
  messageId: string | null | undefined,
  contentHash: string | null | undefined,
): Promise<boolean> {
  const encScope = {
    tenantId: settings.tenantId,
    organizationId: settings.organizationId,
  }
  const whereBase = {
    organizationId: settings.organizationId,
    tenantId: settings.tenantId,
    deletedAt: null,
  }

  if (messageId) {
    const byMessageId = await findOneWithDecryption(em, InboxEmail, { ...whereBase, messageId }, undefined, encScope)
    if (byMessageId) return true
  }

  if (contentHash) {
    const byHash = await findOneWithDecryption(em, InboxEmail, { ...whereBase, contentHash }, undefined, encScope)
    if (byHash) return true
  }

  return false
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Inbound email webhook',
  methods: {
    POST: {
      summary: 'Receive forwarded email from provider webhook',
      description: 'Public endpoint — validated by provider HMAC signature or Resend/Svix signature. Rate limited per tenant.',
      requestBody: {
        contentType: 'application/json',
        schema: z.object({
          from: z.string().optional(),
          to: z.union([z.string(), z.array(z.string())]).optional(),
          subject: z.string().optional(),
          text: z.string().optional(),
          html: z.string().optional(),
          messageId: z.string().optional(),
          replyTo: z.string().optional(),
          inReplyTo: z.string().optional(),
          references: z.union([z.string(), z.array(z.string())]).optional(),
        }),
      },
      responses: [
        { status: 200, description: 'Email received and queued for processing' },
        { status: 400, description: 'Invalid payload or signature' },
        { status: 413, description: 'Payload too large' },
        { status: 429, description: 'Rate limit exceeded' },
        { status: 503, description: 'Webhook secret not configured' },
      ],
    },
  },
}
