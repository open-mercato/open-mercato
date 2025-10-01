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
    const orgId = (args.org as string) || (args.organizationId as string) || null
    const tenantId = (args.tenant as string) || (args.tenantId as string) || null
    const withDeleted = Boolean(args.withDeleted)
    const limit = args.limit ? Number(args.limit) : undefined
    const offset = args.offset ? Number(args.offset) : 0
    if (!entity) {
      console.error('Usage: mercato query_index rebuild --entity <module:entity> [--org <id>] [--tenant <id>] [--withDeleted] [--limit <n>] [--offset <n>]')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const knex = (em as any).getConnection().getKnex()
    const table = baseTableFromEntity(entity)

    const where: any = {}
    if (orgId !== undefined) where.organization_id = orgId
    if (tenantId !== undefined) where.tenant_id = tenantId
    if (!withDeleted) where.deleted_at = null

    let q = knex(table).where(where).select('id')
    if (typeof limit === 'number') q = q.limit(limit)
    if (offset) q = q.offset(offset)

    const rows = await q
    let n = 0
    for (const r of rows) {
      await upsertIndexRow(em, { entityType: entity, recordId: String(r.id), organizationId: orgId, tenantId })
      n++
    }
    console.log(`Rebuilt index for ${n} row(s) of ${entity}${orgId ? ` org=${orgId}` : ''}${tenantId ? ` tenant=${tenantId}` : ''}`)
  },
}

export default [rebuild]

