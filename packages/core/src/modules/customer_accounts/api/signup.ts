import { NextResponse } from 'next/server'
import { compare as bcryptCompare } from 'bcryptjs'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { signupSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { CustomerRole, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import CustomerSignupVerificationEmail from '@open-mercato/core/modules/customer_accounts/emails/CustomerSignupVerificationEmail'
import CustomerExistingAccountEmail from '@open-mercato/core/modules/customer_accounts/emails/CustomerExistingAccountEmail'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  checkAuthRateLimit,
  customerSignupRateLimitConfig,
  customerSignupIpRateLimitConfig,
} from '@open-mercato/core/modules/customer_accounts/lib/rateLimiter'
import { readNormalizedEmailFromJsonRequest } from '@open-mercato/core/modules/customer_accounts/lib/rateLimitIdentifier'
import { findOrganizationInTenant } from '@open-mercato/core/modules/customer_accounts/lib/organizationLookup'
import { getSecurityEmailBaseUrl, mapSecurityEmailUrlError } from '@open-mercato/shared/lib/url'
import {
  resolveTenantContext,
  TenantResolutionError,
} from '@open-mercato/core/modules/customer_accounts/lib/resolveTenantContext'
import { urlForCustomerOrg } from '@open-mercato/core/modules/customer_accounts/lib/customerUrl'

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

// Precomputed bcrypt cost-10 hash of an unknowable random 32-byte input; used to equalize
// response latency between the existing-user and new-user signup branches so the endpoint's
// 202-for-both contract is not undone by a timing side channel.
const TIMING_EQUALIZATION_HASH = '$2b$10$.F2A6UHFzk.d8trNdfqt4OLz05Nf3IOuMmN6VJKflhD4.rz.prR8i'
function resolvePortalLoginUrl(baseUrl: string, organizationSlug?: string | null): string {
  return organizationSlug
    ? `${baseUrl}/${organizationSlug}/portal/login`
    : `${baseUrl}/portal/login`
}

function resolvePortalVerifyUrl(baseUrl: string, token: string, organizationSlug?: string | null): string {
  const route = organizationSlug
    ? `${baseUrl}/${organizationSlug}/portal/verify`
    : `${baseUrl}/portal/verify`
  return `${route}?token=${encodeURIComponent(token)}`
}

export async function POST(req: Request) {
  const rateLimitEmail = await readNormalizedEmailFromJsonRequest(req)
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: customerSignupIpRateLimitConfig,
    compoundConfig: customerSignupRateLimitConfig,
    compoundIdentifier: rateLimitEmail,
  })
  if (rateLimitError) return rateLimitError

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = signupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const { email, password, displayName } = parsed.data
  let tenantId: string
  let organizationId: string | null
  try {
    const context = await resolveTenantContext(req, parsed.data.tenantId)
    tenantId = context.tenantId
    organizationId = context.organizationId ?? parsed.data.organizationId ?? null
  } catch (err) {
    if (err instanceof TenantResolutionError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status })
    }
    throw err
  }
  if (!organizationId) {
    return NextResponse.json({ ok: false, error: 'organizationId is required' }, { status: 400 })
  }

  let baseUrl: string
  try {
    baseUrl = getSecurityEmailBaseUrl(req)
  } catch (error) {
    const mapped = mapSecurityEmailUrlError(error, {
      scope: 'customer_accounts.signup',
      configMessage: 'Customer signup is not configured',
    })
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    throw error
  }

  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const { translate } = await resolveTranslations()

  const orgRow = await findOrganizationInTenant(em, organizationId, tenantId)
  if (!orgRow) {
    return NextResponse.json({ ok: false, error: 'Registration could not be completed' }, { status: 400 })
  }

  const existing = await customerUserService.findByEmail(email, tenantId)
  if (existing) {
    await bcryptCompare(password, TIMING_EQUALIZATION_HASH)
    const existingOrg = await findOrganizationInTenant(em, existing.organizationId, tenantId)
    // Prefer the org's active custom domain when available; fall back to the
    // platform login URL preserved by `resolvePortalLoginUrl`.
    let loginUrl = resolvePortalLoginUrl(baseUrl, existingOrg?.slug ?? null)
    try {
      loginUrl = await urlForCustomerOrg(existing.organizationId, '/login', { container })
    } catch {
      // Fall back to platform URL on any resolution issue.
    }
    const subject = translate('customer_accounts.signup.existing.subject', 'You already have a portal account')
    const copy = {
      preview: translate('customer_accounts.signup.existing.preview', 'A sign-up attempt was made for an email that already has a portal account.'),
      title: translate('customer_accounts.signup.existing.title', 'You already have a portal account'),
      body: translate(
        'customer_accounts.signup.existing.body',
        'A sign-up request was made for this email address. You can sign in with your existing account. If you forgot your password, use the password reset option on the sign-in page.',
      ),
      cta: translate('customer_accounts.signup.existing.cta', 'Open sign-in page'),
      hint: translate(
        'customer_accounts.signup.existing.hint',
        'If this was not you, you can ignore this message. No new portal account was created.',
      ),
    }

    void sendEmail({
      to: existing.email,
      subject,
      react: CustomerExistingAccountEmail({ loginUrl, copy }),
    }).catch((error) => {
      console.error('[customer_accounts.signup] existing-account email failed', error)
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  }

  const user = await customerUserService.createUser(email, password, displayName, { tenantId, organizationId })

  const defaultRole = await em.findOne(CustomerRole, {
    tenantId,
    isDefault: true,
    deletedAt: null,
  })
  if (defaultRole) {
    const userRole = em.create(CustomerUserRole, {
      user,
      role: defaultRole,
      createdAt: new Date(),
    } as any)
    em.persist(userRole)
  }

  await em.persist(user).flush()

  const verificationToken = await customerTokenService.createEmailVerification(user.id, tenantId)
  let verifyUrl = resolvePortalVerifyUrl(baseUrl, verificationToken, orgRow.slug)
  try {
    verifyUrl = await urlForCustomerOrg(organizationId, `/verify?token=${encodeURIComponent(verificationToken)}`, {
      container,
    })
  } catch {
    // Fall back to the platform-derived URL on any resolution issue.
  }
  const subject = translate('customer_accounts.signup.created.subject', 'Verify your portal account')
  const copy = {
    preview: translate('customer_accounts.signup.created.preview', 'Verify your portal account to finish sign-up.'),
    title: translate('customer_accounts.signup.created.title', 'Verify your portal account'),
    body: translate(
      'customer_accounts.signup.created.body',
      'Your account request was accepted. Confirm your email address to finish setting up portal access.',
    ),
    cta: translate('customer_accounts.signup.created.cta', 'Verify email address'),
    hint: translate(
      'customer_accounts.signup.created.hint',
      'This verification link expires in 24 hours. If you did not request this, you can ignore this email.',
    ),
  }

  void sendEmail({
    to: user.email,
    subject,
    react: CustomerSignupVerificationEmail({ verifyUrl, copy }),
  }).catch((error) => {
    console.error('[customer_accounts.signup] verification email failed', error)
  })

  void emitCustomerAccountsEvent('customer_accounts.user.created', {
    id: user.id,
    email: user.email,
    tenantId,
    organizationId,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true }, { status: 202 })
}

const signupAcceptedSchema = z.object({ ok: z.literal(true) })

const errorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const methodDoc: OpenApiMethodDoc = {
  summary: 'Register a new customer account',
  description: 'Accepts a signup request and always returns 202 to prevent account enumeration.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: signupSchema,
    description: 'Signup payload with email, password, and display name.',
  },
  responses: [
    { status: 202, description: 'Signup accepted', schema: signupAcceptedSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed or invalid request origin', schema: errorSchema },
    { status: 429, description: 'Too many signup attempts', schema: rateLimitErrorSchema },
    { status: 500, description: 'Signup email origin is not configured', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer account registration',
  description: 'Handles customer self-registration without revealing whether the email already exists.',
  methods: { POST: methodDoc },
}
