import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CustomerEntity as CustomerEntityType } from '@open-mercato/core/modules/customers/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { GatewayPaymentLink, GatewayPaymentLinkTransaction } from '../../../../data/entities'
import { readPaymentLinkStoredMetadata } from '../../../../lib/payment-link-page-metadata'
import type { CustomerHandlingMode } from '../../../../lib/payment-link-page-metadata'
import { buildPaymentLinkUrl } from '../../../../lib/payment-links'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { emitPaymentLinkPageEvent } from '../../../../events'

const sessionPayloadSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  companyName: z.string().max(200).optional(),
  acceptedTerms: z.boolean().optional(),
  customFormFields: z.record(z.string(), z.unknown()).optional(),
})

type RequestContainer = AwilixContainer & {
  resolve(name: 'em'): EntityManager
  resolve(name: 'commandBus'): CommandBus
  resolve(name: 'paymentGatewayService'): PaymentGatewayService
}

function buildDisplayName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim()
}

function buildPaymentLinkReturnUrl(baseUrl: string, state: 'success' | 'cancelled'): string {
  const url = new URL(baseUrl)
  url.searchParams.set('checkout', state)
  return url.toString()
}

export const metadata = {
  path: '/payment_link_pages/pay/[token]/session',
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> | { token: string } }) {
  try {
    const { token } = await params
    if (!token) {
      return NextResponse.json({ error: 'Payment link token is required' }, { status: 400 })
    }

    const payload = await readJsonSafe<unknown>(req)
    const parsed = sessionPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      const flattened = parsed.error.flatten()
      return NextResponse.json({
        error: 'Invalid payload',
        details: flattened,
      }, { status: 422 })
    }

    const container = await createRequestContainer()
    const em = (container as RequestContainer).resolve('em')

    const link = await findOneWithDecryption(em, GatewayPaymentLink, { token, deletedAt: null })
    if (!link) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }

    if (link.linkMode !== 'multi') {
      return NextResponse.json({ error: 'This payment link does not support session creation' }, { status: 409 })
    }

    if (link.status !== 'active') {
      return NextResponse.json({ error: 'This payment link is no longer active' }, { status: 409 })
    }

    if (typeof link.maxUses === 'number' && link.maxUses > 0 && link.useCount >= link.maxUses) {
      return NextResponse.json({ error: 'This payment link has reached its maximum number of uses' }, { status: 409 })
    }

    const storedMetadata = readPaymentLinkStoredMetadata(link.metadata)
    const sessionParams = storedMetadata.sessionParams
    if (!sessionParams || !sessionParams.providerKey) {
      return NextResponse.json({ error: 'Payment link session configuration is missing' }, { status: 500 })
    }

    const scope = { organizationId: link.organizationId, tenantId: link.tenantId }
    const service = (container as RequestContainer).resolve('paymentGatewayService')

    const paymentLinkUrl = buildPaymentLinkUrl(new URL(req.url).origin, link.token)

    const { transaction, session } = await service.createPaymentSession({
      providerKey: sessionParams.providerKey,
      paymentId: crypto.randomUUID(),
      amount: sessionParams.amount,
      currencyCode: sessionParams.currencyCode,
      captureMethod: sessionParams.captureMethod as 'automatic' | 'manual' | undefined,
      description: sessionParams.description,
      successUrl: sessionParams.successUrl ?? buildPaymentLinkReturnUrl(paymentLinkUrl, 'success'),
      cancelUrl: sessionParams.cancelUrl ?? buildPaymentLinkReturnUrl(paymentLinkUrl, 'cancelled'),
      metadata: sessionParams.metadata,
      providerInput: sessionParams.providerInput,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    })

    const email = parsed.data.email.trim().toLowerCase()
    const firstName = parsed.data.firstName?.trim() || ''
    const lastName = parsed.data.lastName?.trim() || ''
    const phone = parsed.data.phone?.trim() || null
    const companyName = parsed.data.companyName?.trim() || null

    const customerHandlingMode: CustomerHandlingMode = storedMetadata.customerCapture?.customerHandlingMode ?? 'no_customer'
    let personEntityId: string | null = null
    let companyEntityId: string | null = null
    let customerCreated = false

    if (customerHandlingMode === 'create_new') {
      const commandBus = (container as RequestContainer).resolve('commandBus')

      if (companyName) {
        const createdCompany = await commandBus.execute<
          { organizationId: string; tenantId: string; displayName: string },
          { entityId: string; companyId: string }
        >('customers.companies.create', {
          input: { organizationId: link.organizationId, tenantId: link.tenantId, displayName: companyName },
          ctx: {
            container, auth: null, organizationScope: null,
            selectedOrganizationId: link.organizationId,
            organizationIds: [link.organizationId],
            request: req,
          },
        })
        companyEntityId = createdCompany.result.entityId
      }

      const createdPerson = await commandBus.execute<
        {
          organizationId: string; tenantId: string; firstName: string; lastName: string
          displayName: string; primaryEmail: string; primaryPhone?: string; companyEntityId?: string
        },
        { entityId: string; personId: string }
      >('customers.people.create', {
        input: {
          organizationId: link.organizationId, tenantId: link.tenantId,
          firstName, lastName, displayName: buildDisplayName(firstName, lastName),
          primaryEmail: email, primaryPhone: phone ?? undefined,
          companyEntityId: companyEntityId ?? undefined,
        },
        ctx: {
          container, auth: null, organizationScope: null,
          selectedOrganizationId: link.organizationId,
          organizationIds: [link.organizationId],
          request: req,
        },
      })
      personEntityId = createdPerson.result.entityId
      customerCreated = true
    } else if (customerHandlingMode === 'verify_and_merge') {
      const existingPerson = await findOneWithDecryption<CustomerEntityType>(
        em, CustomerEntity,
        { kind: 'person', primaryEmail: email, organizationId: link.organizationId, tenantId: link.tenantId, deletedAt: null } as any,
        undefined, scope,
      )

      if (existingPerson) {
        return NextResponse.json({
          error: 'Email verification required to link to an existing customer',
          requiresVerification: true,
          verificationTarget: email,
        }, { status: 428 })
      }

      // No existing customer — safe to create new
      const commandBus = (container as RequestContainer).resolve('commandBus')

      if (companyName) {
        const createdCompany = await commandBus.execute<
          { organizationId: string; tenantId: string; displayName: string },
          { entityId: string; companyId: string }
        >('customers.companies.create', {
          input: { organizationId: link.organizationId, tenantId: link.tenantId, displayName: companyName },
          ctx: {
            container, auth: null, organizationScope: null,
            selectedOrganizationId: link.organizationId,
            organizationIds: [link.organizationId],
            request: req,
          },
        })
        companyEntityId = createdCompany.result.entityId
      }

      const createdPerson = await commandBus.execute<
        {
          organizationId: string; tenantId: string; firstName: string; lastName: string
          displayName: string; primaryEmail: string; primaryPhone?: string; companyEntityId?: string
        },
        { entityId: string; personId: string }
      >('customers.people.create', {
        input: {
          organizationId: link.organizationId, tenantId: link.tenantId,
          firstName, lastName, displayName: buildDisplayName(firstName, lastName),
          primaryEmail: email, primaryPhone: phone ?? undefined,
          companyEntityId: companyEntityId ?? undefined,
        },
        ctx: {
          container, auth: null, organizationScope: null,
          selectedOrganizationId: link.organizationId,
          organizationIds: [link.organizationId],
          request: req,
        },
      })
      personEntityId = createdPerson.result.entityId
      customerCreated = true
    }
    // customerHandlingMode === 'no_customer': no CRM records, data only in transaction

    const linkTransaction = em.create(GatewayPaymentLinkTransaction, {
      paymentLinkId: link.id,
      transactionId: transaction.id,
      customerEmail: email,
      customerData: {
        firstName: firstName || null,
        lastName: lastName || null,
        phone,
        companyName,
        acceptedTerms: parsed.data.acceptedTerms ?? false,
        customFormFields: parsed.data.customFormFields ?? null,
        customerCreated,
        customerHandlingMode,
        personEntityId,
        companyEntityId,
      },
    })
    em.persist(linkTransaction)

    link.useCount = (link.useCount ?? 0) + 1
    await em.flush()

    await emitPaymentLinkPageEvent('payment_link_pages.link.session_created', {
      paymentLinkId: link.id,
      paymentLinkToken: link.token,
      paymentLinkUrl,
      transactionId: transaction.id,
      paymentId: transaction.paymentId,
      providerKey: transaction.providerKey,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    })

    return NextResponse.json({
      transactionId: transaction.id,
      redirectUrl: session.redirectUrl ?? null,
      clientSecret: session.clientSecret ?? null,
      customerCreated,
      customerHandlingMode,
    }, { status: 201 })
  } catch (error) {
    console.error('[payment_link_pages] POST /pay/[token]/session error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi = {
  tags: ['Payment Link Pages'],
  summary: 'Create a payment session from a multi-use payment link',
  methods: {
    POST: {
      summary: 'Create session for multi-use payment link',
      tags: ['Payment Link Pages'],
      responses: [
        { status: 201, description: 'Session created' },
        { status: 404, description: 'Payment link not found' },
        { status: 409, description: 'Link not eligible for session creation' },
        { status: 422, description: 'Invalid payload' },
        { status: 428, description: 'Email verification required (verify_and_merge mode)' },
      ],
    },
  },
}

export default POST
