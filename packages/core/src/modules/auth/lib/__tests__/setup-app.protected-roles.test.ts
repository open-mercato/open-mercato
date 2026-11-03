/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { Role } from '@open-mercato/core/modules/auth/data/entities'

const tenantId = '33333333-3333-3333-3333-333333333333'

type CreatedRole = { name: string; tenantId: string; minActiveHolders: number }

function makeEm(): { em: EntityManager; created: CreatedRole[] } {
  const created: CreatedRole[] = []
  const em = {
    findOne: async () => null,
    create: (entity: unknown, data: CreatedRole) => {
      if (entity === Role) created.push(data)
      return data
    },
    persist: () => undefined,
    flush: async () => undefined,
    transactional: async (callback: (tem: EntityManager) => Promise<void>) => callback(em),
  } as unknown as EntityManager
  return { em: em as EntityManager, created }
}

/**
 * The protected-role floor is data-driven off `roles.min_active_holders`, so tenant
 * bootstrap is the only thing standing between a new tenant and an unguarded admin
 * role. Migration20260728134212_auth backfills existing tenants; this covers new ones.
 */
describe('ensureRoles protected-role seeding', () => {
  it('seeds admin with a floor of 1 and every other role with 0', async () => {
    const { em, created } = makeEm()

    await ensureRoles(em, { tenantId })

    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'admin', tenantId, minActiveHolders: 1 }),
        expect.objectContaining({ name: 'employee', tenantId, minActiveHolders: 0 }),
        expect.objectContaining({ name: 'superadmin', tenantId, minActiveHolders: 0 }),
      ]),
    )
  })

  it('does not protect a custom role that merely contains "admin" in its name', async () => {
    const { em, created } = makeEm()

    await ensureRoles(em, { tenantId, roleNames: ['administrator', 'admin-assistant', 'admin'] })

    const byName = new Map(created.map((role) => [role.name, role.minActiveHolders]))
    expect(byName.get('administrator')).toBe(0)
    expect(byName.get('admin-assistant')).toBe(0)
    expect(byName.get('admin')).toBe(1)
  })
})
