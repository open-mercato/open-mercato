import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { getCliModules } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { syncDefaultCustomerRoleAcls } from './lib/customerRoleAclSync'

const tenantArgSchema = z.string().trim().min(1)

/**
 * Customer-role counterpart of `mercato auth sync-role-acls`.
 *
 * `defaultCustomerRoleFeatures` is merged into seeded customer roles during
 * tenant setup only, so a tenant that already exists never receives features a
 * module declares later. This command replays that same merge — through the
 * same `syncDefaultCustomerRoleAcls` helper `seedDefaults` calls — against
 * existing tenants.
 */
const syncCustomerRoleAcls: ModuleCli = {
  command: 'sync-customer-role-acls',
  async run(rest) {
    const args: Record<string, string> = {}
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i]
      if (!token?.startsWith('--')) continue
      const key = token.replace(/^--/, '')
      const next = rest[i + 1]
      if (next && !next.startsWith('--')) {
        args[key] = next
        i++
      }
    }
    const tenantArg = args.tenantId ?? args.tenant ?? args.tenant_id ?? null

    const modules = getCliModules()
    if (!modules.length) {
      console.error('❌ No CLI modules registered. Run `yarn generate` first.')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')

    const targetTenantIds: string[] = []
    if (tenantArg !== null) {
      const parsed = tenantArgSchema.safeParse(tenantArg)
      if (!parsed.success) {
        console.error(`❌ Invalid --tenant value: ${tenantArg}`)
        return
      }
      const tenant = await em.findOne(Tenant, { id: parsed.data })
      if (!tenant) {
        console.error(`❌ Tenant not found: ${parsed.data}`)
        return
      }
      targetTenantIds.push(parsed.data)
    } else {
      const tenants = await em.find(Tenant, {})
      if (!tenants.length) {
        console.log('No tenants found; nothing to sync.')
        return
      }
      for (const tenant of tenants) {
        const id = tenant.id ? String(tenant.id) : null
        if (id) targetTenantIds.push(id)
      }
    }

    let updatedRoleCount = 0
    let updatedTenantCount = 0
    for (const tenantId of targetTenantIds) {
      const applied = await syncDefaultCustomerRoleAcls(em, tenantId, modules)
      if (!applied.length) {
        console.log(`✅ Customer role ACLs already in sync for tenant ${tenantId}`)
        continue
      }
      updatedTenantCount += 1
      updatedRoleCount += applied.length
      console.log(`✅ Synced customer role ACLs for tenant ${tenantId}`)
      for (const entry of applied) {
        console.log(`   • ${entry.roleName} (${entry.roleSlug}) gained: ${entry.addedFeatures.join(', ')}`)
      }
    }

    if (!updatedRoleCount) {
      console.log(`Nothing to do — ${targetTenantIds.length} tenant(s) already in sync.`)
      return
    }
    console.log(`Updated ${updatedRoleCount} customer role ACL(s) across ${updatedTenantCount} tenant(s).`)
  },
}

const commands: ModuleCli[] = [syncCustomerRoleAcls]

export default commands
