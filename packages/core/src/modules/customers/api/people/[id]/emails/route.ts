import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveAuthActorId } from '../../../../lib/interactionRequestContext'
import { CustomerEntity } from '../../../../data/entities'

export const metadata = {
  path: '/customers/people/[id]/emails',
  POST: {
    requireAuth: true,
    requireFeatures: ['customers.email.compose'],
  },
}

const composeSchema = z
  .object({
    userChannelId: z.string().uuid(),
    to: z.array(z.string().email()).min(1).max(50),
    cc: z.array(z.string().email()).max(50).optional(),
    bcc: z.array(z.string().email()).max(50).optional(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(200_000),
    bodyFormat: z.enum(['text', 'html']).default('html'),
    visibility: z.enum(['private', 'shared']).default('private'),
    inReplyTo: z.string().max(500).optional(),
    references: z.array(z.string().max(500)).max(50).optional(),
  })
  .strict()

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { id: personId } = await context.params
  if (!z.string().uuid().safeParse(personId).success) {
    return NextResponse.json({ error: 'Invalid person id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof composeSchema>
  try {
    body = composeSchema.parse(await req.json().catch(() => null))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const userId = resolveAuthActorId(auth)

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: (auth as { orgId?: string | null }).orgId ?? null,
    userId,
    resourceKind: 'customers.person',
    resourceId: personId,
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const dscope = { tenantId: auth.tenantId as string, organizationId }

  // 1. Verify the Person exists in the caller's tenant.
  //    Uses CustomerEntity (kind='person') as the canonical ownership check —
  //    the same pattern as the existing [id]/route.ts GET handler.
  const person = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: personId, kind: 'person', tenantId: auth.tenantId, deletedAt: null } as any,
    undefined,
    dscope,
  )
  if (!person) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  // 2. Call the hub's send-as-user facade via internal HTTP so the customers
  //    module never imports hub internals directly (no cross-module coupling).
  //    Auth cookies + authorization header are forwarded so the hub sees the
  //    same identity and can verify channel ownership.
  //    `crmVisibility` and `crmPersonId` are injected as channelMetadata so the
  //    link-channel-message subscriber can use them when anchoring the sent
  //    message back to this Person on the `communication_channels.message.sent` event.
  const hubBody = {
    userChannelId: body.userChannelId,
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    subject: body.subject,
    body: body.bodyFormat === 'html' ? { html: body.body } : { plain: body.body },
    inReplyTo: body.inReplyTo,
    references: body.references,
    channelMetadata: {
      crmVisibility: body.visibility,
      crmPersonId: personId,
    },
  }

  const sendResponse = await fetch(
    new URL('/api/communication_channels/send-as-user', req.url).toString(),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: req.headers.get('cookie') ?? '',
        authorization: req.headers.get('authorization') ?? '',
      },
      body: JSON.stringify(hubBody),
    },
  )

  if (!sendResponse.ok) {
    const errorBody = (await sendResponse.json().catch(() => null)) as { error?: string } | null
    const status =
      sendResponse.status >= 400 && sendResponse.status < 600 ? sendResponse.status : 502
    return NextResponse.json({ error: errorBody?.error ?? 'Send failed' }, { status })
  }

  const result = (await sendResponse.json().catch(() => ({}))) as {
    messageId?: string
    externalMessageId?: string
    sentAt?: string
  }

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId,
      resourceKind: 'customers.person',
      resourceId: personId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  return NextResponse.json({
    messageId: result.messageId ?? null,
    externalMessageId: result.externalMessageId ?? null,
    sentAt: result.sentAt ?? new Date().toISOString(),
  })
}

export const openApi = {
  tags: ['Customers', 'Email'],
  methods: {
    POST: {
      summary: 'Compose + send an email anchored to a Person',
      tags: ['Customers', 'Email'],
      responses: [
        { status: 200, description: 'Email queued for send' },
        { status: 400, description: 'Invalid person id' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing customers.email.compose feature or mutation guard rejection' },
        { status: 404, description: 'Person not found' },
        { status: 422, description: 'Invalid request body' },
        { status: 502, description: 'Hub returned an error' },
      ],
    },
  },
}
export default POST
