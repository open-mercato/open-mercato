import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getSecurityEmailBaseUrl, mapSecurityEmailUrlError } from '@open-mercato/shared/lib/url'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { defaultLocale, locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { onboardingStartSchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { sendExistingAccountNotice } from '@open-mercato/onboarding/modules/onboarding/lib/existing-account-notice'
import VerificationEmail from '@open-mercato/onboarding/modules/onboarding/emails/VerificationEmail'
import AdminNotificationEmail from '@open-mercato/onboarding/modules/onboarding/emails/AdminNotificationEmail'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { formatPasswordRequirements, getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'

const logger = createLogger('onboarding').child({ component: 'start' })

export const metadata = {
  path: '/onboarding/onboarding',
  POST: {
    requireAuth: false,
    rateLimit: readEndpointRateLimitConfig('ONBOARDING', {
      points: 10,
      duration: 60,
      blockDuration: 60,
      keyPrefix: 'onboarding',
    }),
  },
}

export async function POST(req: Request) {
  if (parseBooleanToken(process.env.SELF_SERVICE_ONBOARDING_ENABLED ?? '') !== true) {
    return NextResponse.json({ ok: false, error: 'Self-service onboarding is disabled.' }, { status: 404 })
  }
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  const rawLocale =
    payload && typeof payload === 'object' && 'locale' in payload && typeof (payload as any).locale === 'string'
      ? (payload as any).locale as string
      : null
  const locale: Locale = rawLocale && locales.includes(rawLocale as Locale)
    ? (rawLocale as Locale)
    : defaultLocale
  const dict = await loadDictionary(locale)
  const translate = createFallbackTranslator(dict)
  const passwordRequirements = formatPasswordRequirements(
    getPasswordPolicy(),
    translate,
    'onboarding.password.requirements',
  )

  const parsed = onboardingStartSchema.safeParse(payload)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]
      if (!path) continue
      switch (path) {
        case 'email':
          fieldErrors.email = translate('onboarding.errors.emailInvalid', 'Enter a valid work email.')
          break
        case 'firstName':
          fieldErrors.firstName = translate('onboarding.errors.firstNameRequired', 'First name is required.')
          break
        case 'lastName':
          fieldErrors.lastName = translate('onboarding.errors.lastNameRequired', 'Last name is required.')
          break
        case 'organizationName':
          fieldErrors.organizationName = translate('onboarding.errors.organizationNameRequired', 'Organization name is required.')
          break
        case 'password':
          fieldErrors.password = translate(
            'onboarding.errors.passwordRequired',
            'Password must meet the requirements: {requirements}.',
            { requirements: passwordRequirements },
          )
          break
        case 'confirmPassword':
          fieldErrors.confirmPassword = translate('onboarding.errors.passwordMismatch', 'Passwords must match.')
          break
        case 'termsAccepted':
          fieldErrors.termsAccepted = translate('onboarding.form.termsRequired', 'Please accept the terms to continue.')
          break
        default:
          break
      }
    }
    return NextResponse.json({
      ok: false,
      error: translate('onboarding.form.genericError', 'Please check the form and try again.'),
      fieldErrors,
    }, { status: 400 })
  }

  // An unauthenticated caller must not be able to tell whether the submitted address
  // already has an account (#5505), so every accepted submission answers with this exact
  // body and a caller-visible email failure looks the same on both branches.
  const acceptedResponse = () => NextResponse.json({ ok: true, email: parsed.data.email })
  const emailSendFailedResponse = () => NextResponse.json({
    ok: false,
    error: translate(
      'onboarding.errors.emailSendFailed',
      'We could not send the verification email. Please try again or contact support.',
    ),
  }, { status: 502 })

  try {
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)

    // Resolved before the account lookup so a misconfigured APP_URL fails the same way for
    // both branches instead of becoming a second way to probe for an existing account.
    let baseUrl: string
    try {
      baseUrl = getSecurityEmailBaseUrl(req)
    } catch (error) {
      const mapped = mapSecurityEmailUrlError(error, {
        scope: 'onboarding.start',
        configMessage: 'Self-service onboarding is not configured.',
      })
      if (mapped) return NextResponse.json({ ok: false, error: mapped.body.error }, { status: mapped.status })
      throw error
    }

    const existingUser = await findOneWithDecryption(em, User, {
      deletedAt: null,
      $or: [
        { email: parsed.data.email },
        { emailHash: { $in: lookupHashCandidates(parsed.data.email) } },
      ],
    })
    if (existingUser) {
      // The notice goes to the account owner, not to the submitter, so it is rendered in the
      // instance default locale rather than the one this request carried — the submitter must
      // not get to choose which language lands in someone else's inbox.
      const noticeTranslate = locale === defaultLocale
        ? translate
        : createFallbackTranslator(await loadDictionary(defaultLocale))
      // Never create an onboarding request for an address that already has an account —
      // the submitter's name and organization must not reach the account owner's inbox.
      // The neutral notice below is the only, out-of-band acknowledgement of the account.
      try {
        await sendExistingAccountNotice({
          container,
          email: parsed.data.email,
          loginUrl: `${baseUrl}/login`,
          subject: noticeTranslate('onboarding.existingAccountEmail.subject', 'About your Open Mercato account'),
          copy: {
            preview: noticeTranslate(
              'onboarding.existingAccountEmail.preview',
              'Someone tried to create an Open Mercato workspace with this email address.',
            ),
            heading: noticeTranslate('onboarding.existingAccountEmail.heading', 'You already have an account'),
            greeting: noticeTranslate('onboarding.existingAccountEmail.greeting', 'Hello,'),
            body: noticeTranslate(
              'onboarding.existingAccountEmail.body',
              'Someone just used this email address to start creating an Open Mercato workspace. This address already has an account, so we did not create a new one.',
            ),
            cta: noticeTranslate('onboarding.existingAccountEmail.cta', 'Sign in'),
            ignore: noticeTranslate(
              'onboarding.existingAccountEmail.ignore',
              "If this was you, sign in or reset your password. If it wasn't, you can safely ignore this message — nothing about your account has changed.",
            ),
            footer: noticeTranslate('onboarding.existingAccountEmail.footer', 'Open Mercato · Onboarding service'),
          },
        })
      } catch (err) {
        logger.error('Existing account notice email failed', { err })
        return emailSendFailedResponse()
      }
      return acceptedResponse()
    }

    const service = new OnboardingService(em)
    let request, token
    try {
      const result = await service.createOrUpdateRequest(parsed.data)
      request = result.request
      token = result.token
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('PENDING_REQUEST:')) {
        // The pending-request window is an anti-spam throttle, not a caller-visible state:
        // reporting it would let two probes rebuild the enumeration oracle, because the
        // window only ever exists for an address that has no account.
        logger.info('Onboarding request throttled by pending verification')
        return acceptedResponse()
      }
      throw err
    }

    const verifyUrl = `${baseUrl}/api/onboarding/onboarding/verify?token=${token}`

    const firstName = request.firstName || parsed.data.firstName
    const hasMarketingConsent = request.marketingConsent === true
    const marketingConsentText = hasMarketingConsent
      ? translate('onboarding.email.marketingConsentYes', 'Marketing consent: Yes')
      : translate('onboarding.email.marketingConsentNo', 'Marketing consent: No')
    const subject = translate('onboarding.email.subject', 'Confirm your email to finish onboarding')
    const emailCopy = {
      preview: translate('onboarding.email.preview', 'Confirm your email to activate your Open Mercato workspace'),
      heading: translate('onboarding.email.heading', 'Welcome to Open Mercato'),
      greeting: translate('onboarding.email.greeting', 'Hi {firstName},', { firstName }),
      body: translate(
        'onboarding.email.body',
        'We just need to confirm your email address to finish setting up the organization {organizationName}.',
        { organizationName: request.organizationName },
      ),
      cta: translate('onboarding.email.cta', 'Confirm email & activate workspace'),
      expiry: translate(
        'onboarding.email.expiry',
        "The link will expire in 24 hours. If you didn't request this, you can safely ignore this message.",
      ),
      marketingConsent: marketingConsentText,
      footer: translate('onboarding.email.footer', 'Open Mercato · Onboarding service'),
    }
    const emailReact = VerificationEmail({ verifyUrl, copy: emailCopy })
    try {
      await sendEmail({ to: request.email, subject, react: emailReact })
    } catch (err) {
      request.lastEmailSentAt = null
      await em.flush()
      logger.error('Verification email failed', { err })
      return emailSendFailedResponse()
    }

    const adminEmail = process.env.ADMIN_EMAIL || 'piotr@catchthetornado.com'
    const adminSubject = translate('onboarding.email.adminSubject', 'New self-service onboarding request')
    const adminCopy = {
      preview: translate('onboarding.email.adminPreview', 'New onboarding request submitted'),
      heading: translate('onboarding.email.adminHeading', 'New onboarding request'),
      body: translate('onboarding.email.adminBody', '{firstName} {lastName} ({email}) submitted an onboarding request for {organizationName}.', {
        firstName: request.firstName,
        lastName: request.lastName,
        email: request.email,
        organizationName: request.organizationName,
      }),
      marketingConsent: marketingConsentText,
      footer: translate('onboarding.email.adminFooter', 'You can review the tenant after verification is complete.'),
    }
    try {
      await sendEmail({
        to: adminEmail,
        subject: adminSubject,
        react: AdminNotificationEmail({ copy: adminCopy }),
      })
    } catch (err) {
      logger.error('Admin email failed', { err })
    }

    return acceptedResponse()
  } catch (error) {
    logger.error('Onboarding start failed', { err: error })
    return NextResponse.json({
      ok: false,
      error: translate('onboarding.form.genericError', 'Something went wrong. Please try again later.'),
    }, { status: 500 })
  }
}

export default POST

const onboardingTag = 'Onboarding'

const onboardingSuccessSchema = z.object({
  ok: z.literal(true),
  email: z.string().email(),
})

const onboardingErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
})

const onboardingPostDoc: OpenApiMethodDoc = {
  summary: 'Submit onboarding request',
  description: 'Accepts a self-service onboarding form submission and triggers email verification. The response never reveals whether the submitted address already has an account: an address that does receives an out-of-band notice email instead of a verification link, and the caller sees the same accepted response either way. The guarantee covers the response status and body, not response latency — the new-address branch hashes a password and sends two emails where the existing-account branch sends one, so a caller that measures timing can still tell them apart. Deployments should also keep rate limiting enabled (and use the redis strategy when running more than one replica): the per-address window on the existing-account notice is backed by the rate limiter, so with rate limiting disabled the address owner receives one notice per accepted submission instead of one per ten minutes.',
  tags: [onboardingTag],
  requestBody: {
    contentType: 'application/json',
    schema: onboardingStartSchema,
    description: 'Onboarding form payload with contact and organization information.',
  },
  responses: [
    { status: 200, description: 'Onboarding request accepted. Returned for a new address, for an address that already has an account, and for a submission inside the pending-verification window.', schema: onboardingSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: onboardingErrorSchema },
    { status: 404, description: 'Self-service onboarding disabled', schema: onboardingErrorSchema },
    { status: 429, description: 'Too many onboarding submissions from this IP', schema: rateLimitErrorSchema },
    { status: 500, description: 'Unexpected server error', schema: onboardingErrorSchema },
    { status: 502, description: 'Outbound email could not be delivered', schema: onboardingErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: onboardingTag,
  summary: 'Self-service onboarding submission',
  methods: {
    POST: onboardingPostDoc,
  },
}
