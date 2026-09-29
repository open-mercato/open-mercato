import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { eraseSubjectData, exportSubjectData } from '../../../../lib/gdpr.js'

/**
 * A customer's marketing data: hand it over, or stop holding it.
 *
 * **No new ACL feature.** Both actions are gated by the pair that already describes them —
 * `marketing_automation.runs.view` (this module's per-customer data) and `customers.people.manage` (the
 * right to change a customer's records). Minting a `gdpr.*` feature would have meant editing the platform's
 * own ACL translation catalogue for a permission that is exactly the intersection of two existing ones, and
 * a module should not grow the platform's permission surface to describe something already describable.
 *
 * GET exports. POST erases, and takes a confirmation in the body — a destructive action reached by URL
 * alone is one somebody performs by accident.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view', 'customers.people.manage'] },
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view', 'customers.people.manage'] },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

const eraseSchema = z.object({
  /** Spelled out rather than a boolean: a mistyped `true` should not erase somebody. */
  confirm: z.literal('erase'),
})

function readCustomerId(req: Request): string | null {
  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../customers/<id>/gdpr
  return segments[segments.length - 2] ?? null
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const customerId = readCustomerId(req)
  if (!customerId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const data = await exportSubjectData(em, customerId, scope, new Date())
  return NextResponse.json(data, {
    // Not cacheable by anything: this is one person's complete marketing record.
    headers: { 'cache-control': 'no-store' },
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const customerId = readCustomerId(req)
  if (!customerId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = eraseSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Send {"confirm":"erase"} to erase this customer marketing data', code: 'marketing_automation.errors.eraseNotConfirmed' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const report = await eraseSubjectData(em, customerId, scope, new Date())
  // Logged deliberately: an erasure is the one operation somebody will later need to prove happened, and
  // the report contains counts rather than content.
  logger.info('marketing subject data erased', {
    subjectEntityId: customerId,
    runs: report.runs,
    messages: report.messages,
    scoreEntries: report.scoreEntries,
    surveyAnswers: report.surveyAnswers,
    referralRows: report.referralRows,
    preferencesDeleted: report.preferencesDeleted,
    productWatchesDeleted: report.productWatchesDeleted,
    consentKept: report.consentKept,
    // `sub` rather than `userId`: the latter is optional on the session context, so the one log line that
    // has to name who did this was recording `null` for every erasure performed by a logged-in person.
    actor: auth.sub,
  })
  return NextResponse.json(report)
}

export const openApi = {
  GET: {
    summary: 'Export a customer marketing data',
    description:
      'Everything this module holds about one person: consent and its history, score entries, campaign runs, messages and engagement. Curated rather than dumped — internal ids and the engine context are not part of what the data says about them.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The export' } },
  },
  POST: {
    summary: 'Erase a customer marketing data',
    description:
      'Unlinks the person from every row this module holds, including the subject id inside the run context, and keeps the rows so historical campaign totals stay true. Consent records are deliberately KEPT, because forgetting an unsubscribe is how somebody gets mailed again. Requires {"confirm":"erase"} in the body.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The erasure report' }, 400: { description: 'Not confirmed' } },
  },
}
