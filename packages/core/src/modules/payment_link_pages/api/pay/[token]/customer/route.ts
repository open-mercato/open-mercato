import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerEntity, CustomerPersonProfile } from '../../../../../customers/data/entities'
import { buildPaymentLinkStoredMetadata } from '../../../../../payment_gateways/lib/payment-link-page-metadata'
import { loadPublicPaymentLinkState } from '../../../../../payment_gateways/lib/public-payment-links'
import { emitPaymentLinkPageEvent } from '../../../../events'

const customerCapturePayloadSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(50).optional(),
  companyName: z.string().trim().max(200).optional(),
  acceptedTerms: z.boolean().optional(),
})

type RequestContainer = AwilixContainer & {
  resolve(name: 'commandBus'): CommandBus
  resolve(name: 'em'): EntityManager
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildDisplayName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim()
}

export const metadata = {
  path: '/payment_link_pages/pay/[token]/customer',
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> | { token: string } }) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: 'Payment link token is required' }, { status: 400 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = customerCapturePayloadSchema.safeParse(payload)
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return NextResponse.json({
      error: 'Invalid payload',
      details: flattened,
    }, { status: 422 })
  }

  const container = await createRequestContainer()
  const state = await loadPublicPaymentLinkState({
    container: container as RequestContainer,
    req,
    token,
  })
  if (!state) {
    return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
  }
  if (state.passwordRequired) {
    return NextResponse.json({ error: 'Password required' }, { status: 403 })
  }
  if (!state.customerCapture?.enabled) {
    return NextResponse.json({ error: 'Customer capture is disabled for this payment link' }, { status: 409 })
  }

  const commandBus = (container as RequestContainer).resolve('commandBus')
  const em = (container as RequestContainer).resolve('em')
  const scope = { organizationId: state.link.organizationId, tenantId: state.link.tenantId }

  const firstName = parsed.data.firstName.trim()
  const lastName = parsed.data.lastName.trim()
  const email = parsed.data.email.trim().toLowerCase()
  const phone = normalizeOptionalString(parsed.data.phone)
  const companyName = normalizeOptionalString(parsed.data.companyName)

  if (state.customerCapture.companyRequired && !companyName) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 422 })
  }
  if (state.customerCapture.termsRequired && parsed.data.acceptedTerms !== true) {
    return NextResponse.json({ error: 'Terms must be accepted' }, { status: 422 })
  }

  let companyEntityId = state.customerCapture.companyEntityId ?? null
  let personEntityId = state.customerCapture.personEntityId ?? null

  if (!companyEntityId && companyName) {
    const existingCompany = await findOneWithDecryption(
      em,
      CustomerEntity,
      {
        kind: 'company',
        displayName: companyName,
        organizationId: state.link.organizationId,
        tenantId: state.link.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    if (existingCompany) {
      companyEntityId = existingCompany.id
    } else {
      const createdCompany = await commandBus.execute<
        { organizationId: string; tenantId: string; displayName: string },
        { entityId: string; companyId: string }
      >('customers.companies.create', {
        input: {
          organizationId: state.link.organizationId,
          tenantId: state.link.tenantId,
          displayName: companyName,
        },
        ctx: {
          container,
          auth: null,
          organizationScope: null,
          selectedOrganizationId: state.link.organizationId,
          organizationIds: [state.link.organizationId],
          request: req,
        },
      })
      companyEntityId = createdCompany.result.entityId
    }
  }

  if (!personEntityId) {
    const existingPerson = await findOneWithDecryption(
      em,
      CustomerEntity,
      {
        kind: 'person',
        primaryEmail: email,
        organizationId: state.link.organizationId,
        tenantId: state.link.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    if (existingPerson) {
      personEntityId = existingPerson.id
    } else {
      const createdPerson = await commandBus.execute<
        {
          organizationId: string
          tenantId: string
          firstName: string
          lastName: string
          displayName: string
          primaryEmail: string
          primaryPhone?: string
          companyEntityId?: string
        },
        { entityId: string; personId: string }
      >('customers.people.create', {
        input: {
          organizationId: state.link.organizationId,
          tenantId: state.link.tenantId,
          firstName,
          lastName,
          displayName: buildDisplayName(firstName, lastName),
          primaryEmail: email,
          primaryPhone: phone ?? undefined,
          companyEntityId: companyEntityId ?? undefined,
        },
        ctx: {
          container,
          auth: null,
          organizationScope: null,
          selectedOrganizationId: state.link.organizationId,
          organizationIds: [state.link.organizationId],
          request: req,
        },
      })
      personEntityId = createdPerson.result.entityId
    }
  }

  if (personEntityId && !companyEntityId && companyName) {
    const profile = await em.findOne(CustomerPersonProfile, { entity: personEntityId })
    if (profile?.company) {
      companyEntityId = typeof profile.company === 'string' ? profile.company : profile.company.id
    }
  }

  state.link.metadata = buildPaymentLinkStoredMetadata({
    amount: state.amount,
    currencyCode: state.currencyCode,
    pageMetadata: state.pageMetadata ?? undefined,
    customFields: state.customFields ?? undefined,
    customFieldsetCode: state.customFieldsetCode,
    customerCapture: {
      enabled: true,
      companyRequired: state.customerCapture.companyRequired,
      termsRequired: state.customerCapture.termsRequired,
      termsMarkdown: state.customerCapture.termsMarkdown ?? null,
      collectedAt: new Date().toISOString(),
      termsAcceptedAt: state.customerCapture.termsRequired ? new Date().toISOString() : null,
      companyEntityId,
      personEntityId,
      companyName,
      personName: buildDisplayName(firstName, lastName),
      email,
    },
  })
  await em.flush()

  await emitPaymentLinkPageEvent('payment_link_pages.customer.captured', {
    paymentLinkId: state.link.id,
    paymentLinkToken: state.link.token,
    transactionId: state.transaction.id,
    paymentId: state.transaction.paymentId,
    providerKey: state.transaction.providerKey,
    organizationId: state.link.organizationId,
    tenantId: state.link.tenantId,
    customer: {
      companyEntityId,
      personEntityId,
      companyName,
      personName: buildDisplayName(firstName, lastName),
      email,
    },
  })

  return NextResponse.json({
    ok: true,
    customerCapture: {
      enabled: true,
      companyRequired: state.customerCapture.companyRequired,
      termsRequired: state.customerCapture.termsRequired,
      termsMarkdown: state.customerCapture.termsMarkdown ?? null,
      collectedAt: new Date().toISOString(),
      termsAcceptedAt: state.customerCapture.termsRequired ? new Date().toISOString() : null,
      companyEntityId,
      personEntityId,
      companyName,
      personName: buildDisplayName(firstName, lastName),
      email,
    },
  })
}

export const openApi = {
  tags: ['Payment Link Pages'],
  summary: 'Capture customer details for a public payment link before checkout',
  methods: {
    POST: {
      summary: 'Submit customer details for a payment link',
      tags: ['Payment Link Pages'],
      responses: [
        { status: 200, description: 'Customer details captured' },
        { status: 403, description: 'Password required' },
        { status: 404, description: 'Payment link not found' },
        { status: 409, description: 'Customer capture disabled' },
        { status: 422, description: 'Invalid payload' },
      ],
    },
  },
}

export default POST
