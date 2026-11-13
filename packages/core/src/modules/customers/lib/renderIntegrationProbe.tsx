import { appendFile } from 'node:fs/promises'
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { notFound } from 'next/navigation'
import { sql } from 'kysely'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveDatabaseExecutionContext, type DatabaseContextResolution } from '@open-mercato/shared/lib/db/runtime'
import { CustomerEntity } from '../data/entities'

type ProbeScope = Extract<DatabaseContextResolution, { status: 'resolved' }>

const idsSchema = z.array(z.string().uuid()).min(1).max(10)
const requestIdSchema = z.string().uuid()
const delaySchema = z.coerce.number().int().min(0).max(1_000)
type ProbeRow = { id: string; tenantId: string; configuredTenant: string }

async function recordProbe(requestId: string, event: Readonly<Record<string, unknown>>): Promise<void> {
  const evidenceFile = process.env.OM_RLS_PROBE_EVIDENCE_FILE
  if (evidenceFile) await appendFile(evidenceFile, JSON.stringify({ requestId, ...event }) + '\n')
}

async function DeferredCanaryProbe({ ids, requestId, pause, scope }: {
  ids: string[]; requestId: string; pause: number; scope: ProbeScope
}) {
  await delay(pause)
  try {
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const metadata = em.getMetadata().get(CustomerEntity)
      const result = await sql<ProbeRow>`
        select id, tenant_id as "tenantId", current_setting('app.current_tenant_id', true) as "configuredTenant"
        from ${sql.table(`${metadata.schema ?? 'public'}.${metadata.tableName}`)} where id in (${sql.join(ids)}) order by id
      `.execute(em.getKysely())
      const current = await resolveDatabaseExecutionContext()
      const invocationMatches = current.status === 'resolved' && current.invocation.token === scope.invocation.token
      if (!invocationMatches || result.rows.some((row) => row.tenantId !== scope.context.tenantId || row.configuredTenant !== scope.context.tenantId)) {
        throw new Error('[internal] RLS integration probe detected an invalid tenant boundary')
      }
      await recordProbe(requestId, { phase: 'queried', active: scope.invocation.isActive(), tenantId: scope.context.tenantId, invocationMatches })
      return <pre data-testid="tenant-boundary-probe">{JSON.stringify({ tenantId: scope.context.tenantId, invocationMatches, rows: result.rows })}</pre>
    } finally {
      await container.dispose()
    }
  } catch (error) {
    await recordProbe(requestId, { phase: 'rejected', active: scope.invocation.isActive() })
    throw error
  }
}

export async function renderTenantBoundaryIntegrationProbe() {
  if (!parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false)) return notFound()
  const headerStore = await headers()
  let rawIds: unknown
  try { rawIds = JSON.parse(headerStore.get('x-rls-probe-record-ids') ?? 'null') } catch { return notFound() }
  const ids = idsSchema.safeParse(rawIds)
  const requestId = requestIdSchema.safeParse(headerStore.get('x-rls-probe-id'))
  const pause = delaySchema.safeParse(headerStore.get('x-rls-probe-delay') ?? 0)
  if (!ids.success || !requestId.success || !pause.success) return notFound()
  const scope = await resolveDatabaseExecutionContext()
  if (scope.status !== 'resolved' || scope.context.kind !== 'tenant') return notFound()
  after(async () => {
    await nextTurn()
    await recordProbe(requestId.data, { phase: 'completed', active: scope.invocation.isActive(), tenantId: scope.context.tenantId })
  })
  await recordProbe(requestId.data, { phase: 'started', active: scope.invocation.isActive(), tenantId: scope.context.tenantId })
  return <DeferredCanaryProbe ids={ids.data} requestId={requestId.data} pause={pause.data} scope={scope} />
}
