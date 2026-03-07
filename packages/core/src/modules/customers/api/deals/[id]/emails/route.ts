import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerDealEmail } from '../../../../data/entities'
import { dealEmailSendSchema } from '../../../../data/validators'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandExecuteResult } from '@open-mercato/shared/lib/commands/types'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

async function resolveAuth(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    throw new CrudHttpError(401, { error: 'Authentication required' })
  }
  return { container, auth }
}

async function checkFeature(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  auth: { sub?: string | null; tenantId?: string | null; orgId?: string | null },
  features: string[],
) {
  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }
  if (!rbac || !auth?.sub) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, features, {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
}

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.emails.view'])

    const em = (container.resolve('em') as EntityManager)
    const decryptionScope = { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null }

    const deal = await findOneWithDecryption(
      em,
      CustomerDeal,
      { id: parsedParams.data.id, deletedAt: null },
      {},
      decryptionScope,
    )
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    if (auth.tenantId && deal.tenantId && auth.tenantId !== deal.tenantId) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const offset = (query.page - 1) * query.pageSize

    const where: Record<string, unknown> = {
      dealId: deal.id,
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
    }

    const [emails, total] = await Promise.all([
      findWithDecryption(
        em,
        CustomerDealEmail,
        where,
        { orderBy: { sentAt: 'DESC' }, limit: query.pageSize, offset },
        decryptionScope,
      ),
      em.count(CustomerDealEmail, where),
    ])

    const items = emails.map((email) => ({
      id: email.id,
      dealId: email.dealId,
      threadId: email.threadId ?? null,
      messageId: email.messageId ?? null,
      inReplyTo: email.inReplyTo ?? null,
      direction: email.direction,
      fromAddress: email.fromAddress,
      fromName: email.fromName ?? null,
      toAddresses: email.toAddresses,
      ccAddresses: email.ccAddresses ?? [],
      subject: email.subject,
      bodyText: email.bodyText ?? null,
      bodyHtml: email.bodyHtml ?? null,
      sentAt: email.sentAt instanceof Date ? email.sentAt.toISOString() : email.sentAt,
      provider: email.provider ?? null,
      hasAttachments: email.hasAttachments,
      isRead: email.isRead,
      createdAt: email.createdAt instanceof Date ? email.createdAt.toISOString() : email.createdAt,
    }))

    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.emails.send'])

    const em = (container.resolve('em') as EntityManager)
    const deal = await em.findOne(CustomerDeal, { id: parsedParams.data.id, deletedAt: null })
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    if (auth.tenantId && deal.tenantId && auth.tenantId !== deal.tenantId) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = dealEmailSendSchema.parse(body)

    const commandBus = (container.resolve('commandBus') as CommandBus)
    const { result } = (await commandBus.execute(
      'customers.deal-emails.send',
      {
        input: {
          ...parsed,
          dealId: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
        },
        ctx: {
          container,
          auth,
          organizationScope: null,
          selectedOrganizationId: auth.orgId ?? null,
          organizationIds: auth.orgId ? [auth.orgId] : null,
        },
      },
    )) as CommandExecuteResult<{ emailId: string }>

    return NextResponse.json({ id: result.emailId, ok: true }, { status: 201 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const metadata = {
  methods: ['GET', 'POST'],
  requireAuth: true,
  requireFeatures: ['customers.emails.view'],
}

const emailListItemSchema = z.object({
  id: z.string().uuid(),
  dealId: z.string().uuid(),
  threadId: z.string().nullable(),
  messageId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  direction: z.enum(['inbound', 'outbound']),
  fromAddress: z.string(),
  fromName: z.string().nullable(),
  toAddresses: z.array(z.object({ email: z.string(), name: z.string().optional() })),
  ccAddresses: z.array(z.object({ email: z.string(), name: z.string().optional() })),
  subject: z.string(),
  bodyText: z.string().nullable(),
  bodyHtml: z.string().nullable(),
  sentAt: z.string(),
  provider: z.string().nullable(),
  hasAttachments: z.boolean(),
  isRead: z.boolean(),
  createdAt: z.string(),
})

const emailListResponseSchema = z.object({
  items: z.array(emailListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

const emailSendResponseSchema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deal emails',
  methods: {
    GET: {
      summary: 'List deal emails',
      description: 'Lists emails for a deal, ordered by sent date descending.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, minimum: 1, maximum: 50 } },
      ],
      responses: [
        { status: 200, description: 'Email list', schema: emailListResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Deal not found', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Send email from deal',
      description: 'Sends an email from the deal context. The email is logged on the deal.',
      requestBody: { contentType: 'application/json', schema: dealEmailSendSchema },
      responses: [
        { status: 201, description: 'Email sent', schema: emailSendResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation error', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Deal not found', schema: errorSchema },
      ],
    },
  },
}
