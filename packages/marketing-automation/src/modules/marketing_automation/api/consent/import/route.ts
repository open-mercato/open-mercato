import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findPeopleByAddresses } from '@open-mercato/core/modules/customers/lib/findPeopleByAddresses'
import { parseSuppressionCsv } from '../../../lib/engine/csv-emails.js'
import { MarketingConsent } from '../../../data/entities.js'
import { recordConsent } from '../../../lib/consent.js'
import { readBoundedBody } from '../../../lib/inbound.js'

/**
 * Importing a suppression list from another tool.
 *
 * A shop leaving Mailchimp, Klaviyo or a spreadsheet arrives with a list of people who must never be mailed
 * again, and honouring it is the first thing they need. Recording one such decision has been possible since the
 * operator consent endpoint existed; doing it four thousand times by hand has not.
 *
 * **It can only ever SUPPRESS.** There is no way to import "subscribed", and that is the central decision here
 * rather than a missing feature: a CSV is not consent. Nobody in that file agreed to anything in this system, and
 * an import that could mark people as subscribed would manufacture the exact evidence a shop may one day have to
 * substantiate. Taking somebody off a list needs no such evidence, which is why this direction is safe and the
 * other is not.
 *
 * Gated by `marketing_automation.consent.manage`, like the single-customer endpoint: whoever answers the phone
 * should be able to honour these requests without also being able to author campaigns.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.consent.manage'] },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

/**
 * A suppression list is bigger than a hook payload, and still bounded.
 *
 * Two megabytes is roughly sixty thousand addresses — more than any reasonable single import — and the row cap
 * below is the real limit, because every accepted row is a database write inside one request.
 */
const MAX_CSV_BYTES = 2 * 1024 * 1024

/**
 * Addresses applied per request.
 *
 * Deliberately modest: the lookup decrypts candidate rows and each match is a write, so a request that accepted
 * fifty thousand would be a migration pretending to be an HTTP call. A larger file is imported in parts, and the
 * response says plainly that it was cut rather than reporting success over a fraction.
 */
export const MAX_IMPORT_ROWS = 2_000

const bodySchema = z.object({
  /** The file's contents. Sent as JSON rather than multipart so the reason travels with it in one payload. */
  csv: z.string().min(1),
  /** Where the list came from, in the operator's words. Recorded on every row it suppresses. */
  reason: z.string().trim().min(1).max(200),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readBoundedBody(req, MAX_CSV_BYTES)
  if (!body.ok) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })

  let parsedBody: unknown = null
  try {
    parsedBody = JSON.parse(body.text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'marketing_automation.validation.invalidPayload' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(parsedBody)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }

  const list = parseSuppressionCsv(parsed.data.csv, MAX_IMPORT_ROWS)
  if (list.emails.length === 0) {
    return NextResponse.json({ suppressed: 0, alreadySuppressed: 0, unmatched: 0, skipped: list.skipped, truncated: list.truncated })
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const now = new Date()

  /**
   * One lookup for the whole batch.
   *
   * `primary_email` is encrypted with a random IV, so the platform helper decrypts a bounded window of recent
   * person rows and compares in memory — doing that per address would decrypt the same window once per row. It
   * also means an installation with more people than that window will not match an older customer, which is why
   * `unmatched` is reported rather than assumed to be "not a customer": the operator must be able to see that
   * their list was not fully applied.
   */
  const matches = await findPeopleByAddresses(em, list.emails, scope.tenantId, scope.organizationId)
  const byEmail = new Map(matches.map((person) => [person.email, person.id]))

  /**
   * Who was already unsubscribed, read in ONE query before anything is written.
   *
   * `recordConsent` answers with the state it just set, which is always "unsubscribed" here — so asking it would
   * report the whole file as newly suppressed. The distinction matters to the person running the import: "four
   * thousand suppressed" and "three already were" are different facts about whether the list was worth importing.
   */
  const matchedIds = [...byEmail.values()]
  const priorStates = new Map(
    (await em.find(MarketingConsent, { ...scope, channel: 'email', subjectEntityId: { $in: matchedIds } }))
      .map((record) => [record.subjectEntityId, record.state]),
  )

  let suppressed = 0
  let alreadySuppressed = 0
  const unmatchedEmails: string[] = []

  for (const email of list.emails) {
    const subjectEntityId = byEmail.get(email)
    if (!subjectEntityId) {
      unmatchedEmails.push(email)
      continue
    }
    if (priorStates.get(subjectEntityId) === 'unsubscribed') alreadySuppressed += 1
    else suppressed += 1
    /**
     * Written even when they were already unsubscribed, and that is deliberate.
     *
     * `recordConsent` updates in place, so re-importing the same file changes no state and appends one more trail
     * entry per row — which is the honest record, because somebody did import it again. Skipping the write would
     * make the second import invisible.
     */
    await recordConsent(em, {
      scope,
      subjectEntityId,
      channel: 'email',
      state: 'unsubscribed',
      reason: parsed.data.reason,
      source: 'operator',
      campaignId: null,
      now,
    })
  }

  await em.flush()

  /**
   * Logged, like the single-customer version and for the same reason.
   *
   * "Who took these customers off the list, and when" has a real answer only if it was written down. The
   * addresses are NOT logged: the count and the reason are what an audit needs, and a log line naming four
   * thousand customers' addresses is a second copy of the list in a place nobody is protecting.
   */
  logger.info('marketing suppression list imported', {
    actor: auth.sub,
    suppressed,
    unmatched: unmatchedEmails.length,
    skipped: list.skipped,
    truncated: list.truncated,
    reason: parsed.data.reason,
  })

  return NextResponse.json({
    suppressed,
    alreadySuppressed,
    unmatched: unmatchedEmails.length,
    /**
     * A sample of the addresses nobody matched, so the operator can tell a typo from a person who was never a
     * customer here. Bounded, because the answer is a diagnosis and not the file back again.
     */
    unmatchedSample: unmatchedEmails.slice(0, 20),
    skipped: list.skipped,
    truncated: list.truncated,
  })
}

export const openApi = {
  POST: {
    summary: 'Import a suppression list from another tool',
    description:
      'Takes a CSV of email addresses and records each matching customer as unsubscribed, with the operator\'s reason on every row. It can only SUPPRESS — there is deliberately no way to import "subscribed", because a CSV is not consent. Reports how many were suppressed, how many were already, how many addresses matched no customer here (with a small sample, so a typo is distinguishable from a stranger), how many rows held no address, and whether the file was longer than one request applies. Requires `marketing_automation.consent.manage`.',
    tags: ['Marketing Automation'],
    responses: {
      200: { description: 'What the import did' },
      400: { description: 'Unusable payload' },
      413: { description: 'File too large' },
    },
  },
}
