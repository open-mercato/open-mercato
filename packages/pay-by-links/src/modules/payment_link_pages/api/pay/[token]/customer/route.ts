import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CustomerEntity as CustomerEntityType } from '@open-mercato/core/modules/customers/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { buildPaymentLinkStoredMetadata } from '../../../../lib/payment-link-page-metadata'
import type { CustomerHandlingMode } from '../../../../lib/payment-link-page-metadata'
import { loadPublicPaymentLinkState } from '../../../../lib/public-payment-links'
import { emitPaymentLinkPageEvent } from '../../../../events'

const customerCapturePayloadSchema = z.object({
  firstName: z.string().trim().max(120).optional().default(''),
  lastName: z.string().trim().max(120).optional().default(''),
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

async function createNewCustomer(params: {
  commandBus: CommandBus
  em: EntityManager
  container: AwilixContainer
  link: { organizationId: string; tenantId: string }
  firstName: string
  lastName: string
  email: string
  phone: string | null
  companyName: string | null
  req: Request
}): Promise<{ personEntityId: string; companyEntityId: string | null; customerCreated: boolean }> {
  const { commandBus, container, link, firstName, lastName, email, phone, companyName, req } = params
  let companyEntityId: string | null = null
  let customerCreated = false

  if (companyName) {
    const createdCompany = await commandBus.execute<
      { organizationId: string; tenantId: string; displayName: string },
      { entityId: string; companyId: string }
    >('customers.companies.create', {
      input: {
        organizationId: link.organizationId,
        tenantId: link.tenantId,
        displayName: companyName,
      },
      ctx: {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: link.organizationId,
        organizationIds: [link.organizationId],
        request: req,
      },
    })
    companyEntityId = createdCompany.result.entityId
    customerCreated = true
  }

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
      organizationId: link.organizationId,
      tenantId: link.tenantId,
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
      selectedOrganizationId: link.organizationId,
      organizationIds: [link.organizationId],
      request: req,
    },
  })

  return { personEntityId: createdPerson.result.entityId, companyEntityId, customerCreated: true }
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
  if (!state.transaction) {
    return NextResponse.json({ error: 'No transaction associated with this payment link' }, { status: 409 })
  }
  if (!state.customerCapture?.enabled) {
    return NextResponse.json({ error: 'Customer capture is disabled for this payment link' }, { status: 409 })
  }
  if (state.customerCapture.collectedAt) {
    return NextResponse.json({ error: 'Customer details have already been captured' }, { status: 409 })
  }

  const commandBus = (container as RequestContainer).resolve('commandBus')
  const em = (container as RequestContainer).resolve('em')
  const scope = { organizationId: state.link.organizationId, tenantId: state.link.tenantId }

  const firstName = parsed.data.firstName.trim()
  const lastName = parsed.data.lastName.trim()
  const email = parsed.data.email.trim().toLowerCase()
  const phone = normalizeOptionalString(parsed.data.phone)
  const companyName = normalizeOptionalString(parsed.data.companyName)

  const captureObj = state.customerCapture as Record<string, unknown> | null
  const captureFields = captureObj?.fields as Record<string, { visible?: boolean; required?: boolean }> | undefined

  const isFieldRequired = (name: string): boolean => {
    if (!captureFields) {
      if (name === 'companyName') return captureObj?.companyRequired === true
      if (name === 'phone') return false
      return name === 'firstName' || name === 'lastName'
    }
    return captureFields[name]?.required === true
  }

  if (isFieldRequired('firstName') && !firstName) {
    return NextResponse.json({ error: 'First name is required' }, { status: 422 })
  }
  if (isFieldRequired('lastName') && !lastName) {
    return NextResponse.json({ error: 'Last name is required' }, { status: 422 })
  }
  if (isFieldRequired('companyName') && !companyName) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 422 })
  }
  if (isFieldRequired('phone') && !phone) {
    return NextResponse.json({ error: 'Phone is required' }, { status: 422 })
  }
  if (state.customerCapture.termsRequired && parsed.data.acceptedTerms !== true) {
    return NextResponse.json({ error: 'Terms must be accepted' }, { status: 422 })
  }

  const customerHandlingMode: CustomerHandlingMode = state.customerCapture.customerHandlingMode ?? 'no_customer'

  let companyEntityId: string | null = state.customerCapture.companyEntityId ?? null
  let personEntityId: string | null = state.customerCapture.personEntityId ?? null
  let customerCreated = false

  if (customerHandlingMode === 'create_new') {
    const result = await createNewCustomer({
      commandBus, em, container, link: state.link,
      firstName, lastName, email, phone, companyName, req,
    })
    personEntityId = result.personEntityId
    companyEntityId = result.companyEntityId
    customerCreated = true
  } else if (customerHandlingMode === 'verify_and_merge') {
    const existingPerson = await findOneWithDecryption<CustomerEntityType>(
      em,
      CustomerEntity,
      {
        kind: 'person',
        primaryEmail: email,
        organizationId: state.link.organizationId,
        tenantId: state.link.tenantId,
        deletedAt: null,
      } as any,
      undefined,
      scope,
    )

    if (existingPerson) {
      // Email matches an existing customer — require email verification before merging.
      // For now, reject and inform the caller that verification is needed.
      // A full email-OTP flow will be added in a future iteration.
      return NextResponse.json({
        error: 'Email verification required to link to an existing customer',
        requiresVerification: true,
        verificationTarget: email,
      }, { status: 428 })
    }

    // No existing customer — safe to create new
    const result = await createNewCustomer({
      commandBus, em, container, link: state.link,
      firstName, lastName, email, phone, companyName, req,
    })
    personEntityId = result.personEntityId
    companyEntityId = result.companyEntityId
    customerCreated = true
  }
  // customerHandlingMode === 'no_customer': skip all CRM creation, data only in metadata

  if (personEntityId && !companyEntityId && companyName) {
    const profile = await findOneWithDecryption(em, CustomerPersonProfile, { entity: personEntityId } as any, undefined, scope) as any
    if (profile?.company) {
      companyEntityId = typeof profile.company === 'string' ? profile.company : profile.company.id
    }
  }

  const collectedAt = new Date().toISOString()
  const termsAcceptedAt = state.customerCapture.termsRequired ? collectedAt : null
  const personName = buildDisplayName(firstName, lastName)

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
      customerHandlingMode,
      fields: captureFields ?? undefined,
      collectedAt,
      termsAcceptedAt,
      companyEntityId,
      personEntityId,
      companyName,
      personName,
      email,
      customerCreated,
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
      personName,
      email,
      customerCreated,
      customerHandlingMode,
    },
  })

  return NextResponse.json({
    ok: true,
    customerCapture: {
      collected: true,
      customerCreated,
      customerHandlingMode,
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
        { status: 428, description: 'Email verification required (verify_and_merge mode)' },
      ],
    },
  },
}

export default POST
