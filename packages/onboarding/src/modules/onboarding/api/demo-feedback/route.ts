import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import FeedbackEmail from '@open-mercato/onboarding/modules/onboarding/emails/FeedbackEmail'
import { checkAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const demoFeedbackIpRateLimitConfig = readEndpointRateLimitConfig('DEMO_FEEDBACK_IP', {
  points: 5, duration: 300, blockDuration: 300, keyPrefix: 'demo-feedback-ip',
})

export const metadata = {
  path: '/onboarding/demo-feedback',
  POST: {
    requireAuth: false,
  },
}

const feedbackSchema = z.object({
  email: z.string().email(),
  message: z.string().max(5000).optional().default(''),
  termsAccepted: z.literal(true),
  marketingConsent: z.boolean().optional().default(false),
  sendCopy: z.boolean().optional().default(true),
})

export async function POST(req: Request) {
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: demoFeedbackIpRateLimitConfig,
  })
  if (rateLimitError) return rateLimitError

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  const parsed = feedbackSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Please check the form and try again.' }, { status: 400 })
  }

  const { email, message, marketingConsent, sendCopy } = parsed.data
  const adminEmail = process.env.ADMIN_EMAIL || 'piotr@catchthetornado.com'

  const marketingText = marketingConsent ? 'Marketing consent: Yes' : 'Marketing consent: No'

  const adminCopy = {
    preview: `Demo feedback from ${email}`,
    heading: 'New demo feedback',
    body: `${email} submitted a feedback/contact request from the demo environment.`,
    senderEmailLabel: 'From email:',
    senderEmail: email,
    messageLabel: 'Message:',
    message: message || '(no message provided)',
    marketingConsent: marketingText,
    footer: 'Open Mercato \u00b7 Demo feedback',
  }

  try {
    await sendEmail({
      to: adminEmail,
      subject: `Demo feedback from ${email}`,
      react: FeedbackEmail({ copy: adminCopy }),
    })
  } catch (err) {
    console.error('[demo-feedback] admin email failed', err)
    return NextResponse.json({ ok: false, error: 'Failed to send feedback. Please try again.' }, { status: 502 })
  }

  if (sendCopy) {
    const userCopy = {
      preview: 'Your feedback to Open Mercato',
      heading: 'Thank you for reaching out!',
      body: 'We received your message and will get back to you shortly. Below is a copy of what you submitted.',
      messageLabel: 'Your message:',
      message: message || '(no message provided)',
      marketingConsent: marketingText,
      footer: 'Open Mercato \u00b7 demo.openmercato.com',
    }
    try {
      await sendEmail({
        to: email,
        subject: 'Your feedback to Open Mercato',
        react: FeedbackEmail({ copy: userCopy }),
      })
    } catch (err) {
      console.error('[demo-feedback] user copy email failed', err)
    }
  }

  return NextResponse.json({ ok: true })
}

export default POST

const feedbackTag = 'Demo'

const feedbackPostDoc: OpenApiMethodDoc = {
  summary: 'Submit demo feedback',
  description: 'Sends a feedback/contact request from the demo environment to the admin and optionally to the user.',
  tags: [feedbackTag],
  requestBody: {
    contentType: 'application/json',
    schema: feedbackSchema,
    description: 'Feedback form payload.',
  },
  responses: [
    { status: 200, description: 'Feedback sent successfully.' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: feedbackTag,
  summary: 'Demo feedback submission',
  methods: {
    POST: feedbackPostDoc,
  },
}
