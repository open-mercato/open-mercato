import { getDb } from '@/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { ModuleCli } from '@/modules/registry'

const addUser: ModuleCli = {
  command: 'add-user',
  async run(rest) {
    const args: Record<string, string> = {}
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i]?.replace(/^--/, '')
      const v = rest[i + 1]
      if (k) args[k] = v
    }
    const email = args.email
    const password = args.password
    const organizationId = Number(args.organizationId ?? args.orgId ?? args.org)
    const rolesCsv = (args.roles ?? '').trim()
    if (!email || !password || !organizationId) {
      console.error('Usage: erp auth add-user --email <email> --password <password> --organizationId <id> [--roles customer,employee]')
      return
    }
    const { hash } = await import('bcryptjs')
    const passwordHash = await hash(password, 10)
    const db = getDb()
    const inserted = await db.insert(users).values({ email, organizationId, passwordHash, isConfirmed: true }).returning({ id: users.id })
    const userId = inserted[0]?.id
    if (!userId) {
      console.error('Failed to insert user')
      return
    }
    if (rolesCsv) {
      const { roles, userRoles } = await import('@/db/schema')
      const roleNames = rolesCsv.split(',').map((s) => s.trim()).filter(Boolean)
      for (const name of roleNames) {
        const existing = await db.select().from(roles).where(eq(roles.name, name)).limit(1)
        let roleId = existing[0]?.id
        if (!roleId) {
          const r = await db.insert(roles).values({ name }).returning({ id: roles.id })
          roleId = r[0]?.id
        }
        if (roleId) {
          await db.insert(userRoles).values({ userId, roleId })
        }
      }
    }
    console.log('User created with id', userId)
  },
}

const seedRoles: ModuleCli = {
  command: 'seed-roles',
  async run() {
    const db = getDb()
    const { roles } = await import('@/db/schema')
    const defaults = ['customer', 'employee', 'admin', 'owner']
    for (const name of defaults) {
      const existing = await db.select().from(roles).where(eq(roles.name, name)).limit(1)
      if (existing.length === 0) {
        await db.insert(roles).values({ name })
        console.log('Inserted role', name)
      }
    }
    console.log('Roles ensured')
  },
}

export default [addUser, seedRoles]
