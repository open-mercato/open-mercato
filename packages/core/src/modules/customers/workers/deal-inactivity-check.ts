import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal } from '../data/entities'
import { emitCustomersEvent } from '../events'

export const metadata: WorkerMeta = {
  queue: 'customers:deal-inactivity',
  id: 'deal-inactivity-check',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

interface StaleDealRow {
  id: string
  organization_id: string
  tenant_id: string
  title: string
  owner_user_id: string | null
  last_activity_at: Date | null
}

export default async function handle(_job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')

  const inactivityThreshold = 7 * 24 * 60 * 60 * 1000
  const cutoff = new Date(Date.now() - inactivityThreshold)

  const knex = em.getKnex()
  const rows: StaleDealRow[] = await knex.raw(
    `SELECT id, organization_id, tenant_id, title, owner_user_id, last_activity_at
     FROM customer_deals
     WHERE deleted_at IS NULL
       AND status NOT IN ('won', 'lost')
       AND (
         last_activity_at IS NOT NULL AND last_activity_at < ?
         OR last_activity_at IS NULL AND created_at < ?
       )
     LIMIT 200`,
    [cutoff, cutoff],
  ).then((result: { rows: StaleDealRow[] }) => result.rows)

  if (rows.length === 0) {
    return
  }

  for (const row of rows) {
    await emitCustomersEvent('customers.deal.inactive', {
      dealId: row.id,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      title: row.title,
      ownerUserId: row.owner_user_id,
      lastActivityAt: row.last_activity_at,
    })
  }

  console.log(`[deal-inactivity-check] Detected ${rows.length} inactive deal${rows.length === 1 ? '' : 's'}`)
}
