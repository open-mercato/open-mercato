import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { Queue } from '@open-mercato/queue'
import type { Knex } from 'knex'
import type { EntityManager } from '@mikro-orm/postgresql'
import { clearReindexLock } from '../../../../lib/reindex-lock'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['search.embeddings.manage'] },
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const knex = (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()

  let queue: Queue | undefined
  try {
    queue = container.resolve<Queue>('vectorIndexQueue')
  } catch {
    // Queue not available - just clear the lock
  }

  let jobsRemoved = 0
  if (queue) {
    try {
      const countsBefore = await queue.getJobCounts()
      jobsRemoved = countsBefore.waiting + countsBefore.active
      await queue.clear()
    } catch {
      // Queue clear failed - continue to clear lock
    }
  }

  await clearReindexLock(knex, auth.tenantId, 'vector', auth.orgId ?? null)

  // Log the cancellation
  try {
    const em = container.resolve('em')
    await recordIndexerLog(
      { em },
      {
        source: 'vector',
        handler: 'api:search.embeddings.reindex.cancel',
        message: `Cancelled vector reindex operation (${jobsRemoved} jobs removed)`,
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        details: { jobsRemoved },
      },
    )
  } catch {
    // Logging failure should not fail the cancel operation
  }

  try {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  } catch {
    // Ignore disposal errors
  }

  return NextResponse.json({
    ok: true,
    jobsRemoved,
  })
}
