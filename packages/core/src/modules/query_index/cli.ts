import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { upsertIndexRow } from './lib/indexer'

function parseArgs(rest: string[]) {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a) continue
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=')
      if (v !== undefined) args[k] = v
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) { args[k] = rest[i + 1]!; i++ }
      else args[k] = true
    }
  }
  return args
}

function baseTableFromEntity(entityType: string): string {
  const [, ent] = (entityType || '').split(':')
  if (!ent) throw new Error(`Invalid entityType: ${entityType}`)
  return ent.endsWith('s') ? ent : `${ent}s`
}

  const rebuild: ModuleCli = {
    command: 'rebuild',
    async run(rest: string[]) {
      const args = parseArgs(rest)
      const entity = (args.entity as string) || (args.e as string)
      const globalFlag = Boolean(args.global)
      const orgFlag = (args.org as string) || (args.organizationId as string)
      const tenantFlag = (args.tenant as string) || (args.tenantId as string)
      const orgId = orgFlag || undefined
      const tenantId = tenantFlag || undefined
      const withDeleted = Boolean(args.withDeleted)
      const limit = args.limit ? Number(args.limit) : undefined
      const offset = args.offset ? Number(args.offset) : 0
      if (!entity) {
      console.error('Usage: mercato query_index rebuild --entity <module:entity> [--global] [--org <id>] [--tenant <id>] [--withDeleted] [--limit <n>] [--offset <n>]')
        return
      }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const knex = (em as any).getConnection().getKnex()
    const table = baseTableFromEntity(entity)

    const where: any = {}
    if (!globalFlag) {
      if (orgId !== undefined) where.organization_id = orgId
      if (tenantId !== undefined) where.tenant_id = tenantId
    }
    if (!withDeleted) where.deleted_at = null

    let q = knex(table).where(where).select('id', 'organization_id', 'tenant_id')
    if (typeof limit === 'number') q = q.limit(limit)
    if (offset) q = q.offset(offset)

    const rows = await q
    let n = 0
    for (const r of rows) {
      const scopeOrg = (orgId !== undefined) ? orgId : (r.organization_id ?? null)
      const scopeTenant = (tenantId !== undefined) ? tenantId : (r.tenant_id ?? null)
      await upsertIndexRow(em, { entityType: entity, recordId: String(r.id), organizationId: scopeOrg as any, tenantId: scopeTenant as any })
      n++
    }
    console.log(`Rebuilt index for ${n} row(s) of ${entity}${globalFlag ? ' (global)' : ''}${orgId ? ` org=${orgId}` : ''}${tenantId ? ` tenant=${tenantId}` : ''}`)
    },
  }

// Additional CLI commands: reindex and purge via events for an entity or all
const reindex: ModuleCli = {
  command: 'reindex',
  async run(rest: string[]) {
    const args = parseArgs(rest)
    const { resolve } = await createRequestContainer()
    const bus = resolve('eventBus') as any
    const entity = (args.entity as string) || (args.e as string)
    if (entity) {
      await bus.emitEvent('query_index.reindex', { entityType: entity, organizationId: args.org || args.organizationId, tenantId: args.tenant || args.tenantId }, { persistent: true })
      console.log(`Scheduled reindex for ${entity}`)
      return
    }
    // all entities
    const { E: All } = await import('@/generated/entities.ids.generated') as any
    const ids: string[] = Object.values(All).flatMap((o: any) => Object.values(o || {}))
    for (const id of ids) {
      await bus.emitEvent('query_index.reindex', { entityType: id, organizationId: args.org || args.organizationId, tenantId: args.tenant || args.tenantId }, { persistent: true })
    }
    console.log(`Scheduled reindex for ${ids.length} entities`)
  },
}

const purge: ModuleCli = {
  command: 'purge',
  async run(rest: string[]) {
    const args = parseArgs(rest)
    const { resolve } = await createRequestContainer()
    const bus = resolve('eventBus') as any
    const entity = (args.entity as string) || (args.e as string)
    if (entity) {
      await bus.emitEvent('query_index.purge', { entityType: entity, organizationId: args.org || args.organizationId, tenantId: args.tenant || args.tenantId }, { persistent: true })
      console.log(`Scheduled purge for ${entity}`)
      return
    }
    const { E: All } = await import('@/generated/entities.ids.generated') as any
    const ids: string[] = Object.values(All).flatMap((o: any) => Object.values(o || {}))
    for (const id of ids) {
      await bus.emitEvent('query_index.purge', { entityType: id, organizationId: args.org || args.organizationId, tenantId: args.tenant || args.tenantId }, { persistent: true })
    }
    console.log(`Scheduled purge for ${ids.length} entities`)
  },
}

export default [rebuild, reindex, purge]
