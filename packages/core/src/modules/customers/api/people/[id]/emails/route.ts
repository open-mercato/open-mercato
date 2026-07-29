import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { resolveAuthActorId } from '../../../../lib/interactionRequestContext'
import { CustomerEntity } from '../../../../data/entities'
import type { SendAsUserService } from '@open-mercato/core/modules/communication_channels/lib/send-as-user'

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
    parentMessageId: z.string().uuid().optional(),
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
    body = composeSchema.parse(await readJsonSafe(req, null))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const userId = resolveAuthActorId(auth)
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })

  const em = (container.resolve('em') as EntityManager).fork()

  // 1. Verify the Person exists in the caller's tenant, then fail-closed on the
  //    record's own organization — same pattern as the [id]/route.ts GET handler.
  //    Loading by tenant + id (not a hand-rolled selected org) keeps this working
  //    under the "All organizations" scope; the record's own org then becomes the
  //    concrete org the guard and the outbound message are attributed to.
  const person = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: personId,
      kind: 'person',
      tenantId: auth.tenantId,
      deletedAt: null,
    } as never,
    undefined,
    { tenantId: auth.tenantId as string, organizationId: scope?.selectedId ?? (auth as { orgId?: string | null }).orgId ?? null },
  )
  if (!person) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }
  const organizationId = (person as { organizationId?: string | null }).organizationId ?? null
  if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId })) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId,
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

  // 2. Call the hub's send-as-user facade in-process (resolved via DI) so the
  //    customers module makes no HTTP self-call. `crmVisibility` and `crmPersonId`
  //    are injected as channelMetadata so the link-channel-message subscriber can
  //    anchor the sent message back to this Person on the
  //    `communication_channels.message.sent` event.
  const sendAsUserService = container.resolve(
    'communicationChannelsSendAsUser',
  ) as SendAsUserService

  const sendResult = await sendAsUserService(
    container,
    { userId: auth.sub as string, tenantId: auth.tenantId as string, organizationId, auth },
    {
      userChannelId: body.userChannelId,
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      body: body.bodyFormat === 'html' ? { html: body.body } : { plain: body.body },
      inReplyTo: body.inReplyTo,
      references: body.references,
      parentMessageId: body.parentMessageId,
      channelMetadata: {
        crmVisibility: body.visibility,
        crmPersonId: personId,
      },
    },
  )

  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error }, { status: sendResult.status })
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

  // Delivery is async (handled by the outbound queue worker), so this is the
  // enqueue time — not the provider send time — and the provider's external
  // message id is not known yet (the worker assigns it on successful delivery).
  return NextResponse.json({
    messageId: sendResult.messageId,
    threadId: sendResult.threadId,
    queuedAt: new Date().toISOString(),
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
        { status: 404, description: 'Person or channel not found' },
        { status: 409, description: 'Channel not connected' },
        { status: 422, description: 'Invalid request body' },
        { status: 500, description: 'Send failed' },
      ],
    },
  },
}
export default POST
