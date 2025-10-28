import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@/lib/di/container'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { defaultLocale, locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { sendEmail } from '@/lib/email/send'
import { onboardingStartSchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import VerificationEmail from '@open-mercato/onboarding/modules/onboarding/emails/VerificationEmail'
import AdminNotificationEmail from '@open-mercato/onboarding/modules/onboarding/emails/AdminNotificationEmail'
import { User } from '@open-mercato/core/modules/auth/data/entities'

export const metadata = {
  POST: {
    requireAuth: false,
  },
}

export async function POST(req: Request) {
  if (process.env.SELF_SERVICE_ONBOARDING_ENABLED !== 'true') {
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

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')

    const existingUser = await em.findOne(User, { email: parsed.data.email })
    if (existingUser) {
      const message = translate('onboarding.errors.emailExists', 'We already have an account with this email. Try signing in or resetting your password.')
      return NextResponse.json({
        ok: false,
        error: message,
        fieldErrors: { email: message },
      }, { status: 409 })
    }

    const service = new OnboardingService(em)
    let request, token
    try {
      const result = await service.createOrUpdateRequest(parsed.data)
      request = result.request
      token = result.token
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('PENDING_REQUEST:')) {
        const minutes = Number(err.message.split(':')[1] || '10')
        const message = translate('onboarding.errors.pendingRequest', 'We already have a pending verification. Please try again in about {minutes} minutes or contact the administrator.', { minutes })
        return NextResponse.json({
          ok: false,
          error: message,
          fieldErrors: { email: message },
        }, { status: 409 })
      }
      throw err
    }

    const url = new URL(req.url)
    const baseUrl = process.env.APP_URL || `${url.protocol}//${url.host}`
    const verifyUrl = `${baseUrl}/api/onboarding/onboarding/verify?token=${token}`

    const firstName = request.firstName || parsed.data.firstName
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
      footer: translate('onboarding.email.footer', 'Open Mercato · Tenant onboarding service'),
    }
    const emailReact = VerificationEmail({ verifyUrl, copy: emailCopy })
    await sendEmail({ to: request.email, subject, react: emailReact })

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
      footer: translate('onboarding.email.adminFooter', 'You can review the tenant after verification is complete.'),
    }
    await sendEmail({
      to: adminEmail,
      subject: adminSubject,
      react: AdminNotificationEmail({ copy: adminCopy }),
    })

    return NextResponse.json({ ok: true, email: request.email })
  } catch (error) {
    console.error('[onboarding.start] failed', error)
    return NextResponse.json({
      ok: false,
      error: translate('onboarding.form.genericError', 'Something went wrong. Please try again later.'),
    }, { status: 500 })
  }
}

export default POST
