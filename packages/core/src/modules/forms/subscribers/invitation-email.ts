/**
 * Phase 2d — invitation email dispatch.
 *
 * The `forms.invitation.send` command stamps `sent_at`/`send_count` and emits
 * `forms.invitation.sent`. This subscriber reacts to that event and performs a
 * best-effort email delivery for the recipient.
 *
 * IMPORTANT — token recoverability: a personal invitation's raw token is shown
 * exactly once at create time (only its SHA-256 hash is persisted). The hash is
 * one-way, so a fresh personal-link cannot be derived here. Therefore:
 *
 *   - The PRIMARY personal-link email is enqueued inline by the
 *     `forms.invitation.create` command via `enqueueInvitationEmail(...)` while
 *     the raw token is still in hand (link = `<APP_URL>/i/<rawToken>`).
 *   - This subscriber handles the RESEND path: it sends a generic
 *     "you have a form to complete" reminder WITHOUT a token link (since the
 *     raw token is unrecoverable). Operators re-issue a personal link by
 *     creating a fresh invitation when a working link must be re-delivered.
 *
 * Every email path is fail-soft: failures are recorded on
 * `invitation.last_error` and swallowed — invitation validity never depends on
 * email delivery (R-2d-7).
 */

import * as React from 'react'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { FormInvitation } from '../data/entities'

export const metadata = {
  event: 'forms.invitation.sent',
  persistent: true,
  id: 'forms.invitation-email',
}

type ResolveContainer = {
  resolve: <T = unknown>(key: string) => T
  hasRegistration?: (key: string) => boolean
}

type SubscriberContext = {
  container: ResolveContainer
}

type InvitationSentPayload = {
  invitationId: string
  distributionId: string
}

type InvitationEmailCopy = {
  subject: string
  heading: string
  greeting: string
  body: string
  cta: string | null
  link: string | null
  footer: string
}

function resolveAppUrl(): string | null {
  const raw = process.env.APP_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

function buildInvitationEmailElement(copy: InvitationEmailCopy): React.ReactElement {
  const children: React.ReactNode[] = [
    React.createElement('h1', { key: 'heading' }, copy.heading),
    React.createElement('p', { key: 'greeting' }, copy.greeting),
    React.createElement('p', { key: 'body' }, copy.body),
  ]
  if (copy.cta && copy.link) {
    children.push(React.createElement('a', { key: 'cta', href: copy.link }, copy.cta))
  }
  children.push(React.createElement('p', { key: 'footer' }, copy.footer))
  return React.createElement('div', null, children)
}

/**
 * Persist a delivery error on the invitation row. Best-effort: never throws.
 */
async function recordInvitationError(
  em: EntityManager,
  invitation: FormInvitation,
  message: string,
): Promise<void> {
  try {
    invitation.lastError = message.slice(0, 1000)
    invitation.updatedAt = new Date()
    await em.flush()
  } catch {
    // Swallow — error recording must never escalate a soft failure.
  }
}

/**
 * Best-effort invitation email delivery. Called inline from
 * `forms.invitation.create` (with a fresh personal link) and from this
 * subscriber on resend (without a link). The supplied `em` MUST already be
 * scoped to the invitation; the caller owns the unit of work.
 *
 * Returns `true` when an email was dispatched, `false` when skipped or failed.
 */
export async function enqueueInvitationEmail(args: {
  em: EntityManager
  invitation: FormInvitation
  recipientEmail: string | null
  link: string | null
}): Promise<boolean> {
  const { em, invitation, recipientEmail, link } = args
  const email = recipientEmail?.trim() ?? null
  if (!email) {
    await recordInvitationError(em, invitation, 'no recipient email')
    return false
  }

  try {
    const { translate } = await resolveTranslations()
    const name = invitation.recipientName?.trim() || email
    const copy: InvitationEmailCopy = {
      subject: translate('forms.invitation.email.subject', 'You have a form to complete'),
      heading: translate('forms.invitation.email.heading', 'A form is waiting for you'),
      greeting: translate('forms.invitation.email.greeting', `Hi ${name},`),
      body: link
        ? translate(
            'forms.invitation.email.body',
            'You have been invited to complete a form. Use the secure link below to begin.',
          )
        : translate(
            'forms.invitation.email.body_reminder',
            'This is a reminder that you have a form to complete. Please use the link previously sent to you to continue.',
          ),
      cta: link ? translate('forms.invitation.email.cta', 'Open form') : null,
      link,
      footer: translate('forms.invitation.email.footer', 'Open Mercato Forms'),
    }

    await sendEmail({
      to: email,
      subject: copy.subject,
      react: buildInvitationEmailElement(copy),
    })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordInvitationError(em, invitation, message)
    return false
  }
}

export default async function handleInvitationSent(
  payload: InvitationSentPayload,
  ctx: SubscriberContext,
): Promise<void> {
  let em: EntityManager
  try {
    em = (ctx.container.resolve('em') as EntityManager).fork()
  } catch {
    return
  }

  const invitation = await findOneWithDecryption(
    em,
    FormInvitation,
    { id: payload.invitationId, deletedAt: null },
    undefined,
    {},
  )
  if (!invitation) return

  // Resend path: the raw token is unrecoverable, so no fresh link is built.
  await enqueueInvitationEmail({
    em,
    invitation,
    recipientEmail: invitation.recipientEmail ?? null,
    link: null,
  })
}
