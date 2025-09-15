import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { hash } from 'bcryptjs'
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'

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
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org)
    const rolesCsv = (args.roles ?? '').trim()
    if (!email || !password || !organizationId) {
      console.error('Usage: mercato auth add-user --email <email> --password <password> --organizationId <id> [--roles customer,employee]')
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const org = await em.findOneOrFail(Organization, { id: Number(organizationId) }, { populate: ['tenant'] })
    const u = em.create(User, { email, passwordHash: await hash(password, 10), isConfirmed: true, organization: org, tenant: org.tenant })
    await em.persistAndFlush(u)
    if (rolesCsv) {
      const names = rolesCsv.split(',').map(s => s.trim()).filter(Boolean)
      for (const name of names) {
        let role = await em.findOne(Role, { name })
        if (!role) { role = em.create(Role, { name }); await em.persistAndFlush(role) }
        const link = em.create(UserRole, { user: u, role })
        await em.persistAndFlush(link)
      }
    }
    console.log('User created with id', u.id)
  },
}

const seedRoles: ModuleCli = {
  command: 'seed-roles',
  async run() {
    const defaults = ['customer', 'employee', 'admin', 'owner']
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    for (const name of defaults) {
      const existing = await em.findOne(Role, { name })
      if (!existing) { await em.persistAndFlush(em.create(Role, { name })); console.log('Inserted role', name) }
    }
    console.log('Roles ensured')
  },
}

// will be exported at the bottom with all commands

const addOrganization: ModuleCli = {
  command: 'add-org',
  async run(rest) {
    const args: Record<string, string> = {}
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i]?.replace(/^--/, '')
      const v = rest[i + 1]
      if (k) args[k] = v
    }
    const name = args.name || args.orgName
    if (!name) {
      console.error('Usage: mercato auth add-org --name <organization name>')
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    // Create tenant implicitly for simplicity
    const tenant = em.create(Tenant, { name: `${name} Tenant` })
    await em.persistAndFlush(tenant)
    const org = em.create(Organization, { name, tenant })
    await em.persistAndFlush(org)
    console.log('Organization created with id', org.id, 'in tenant', tenant.id)
  },
}

const setupApp: ModuleCli = {
  command: 'setup',
  async run(rest) {
    const args: Record<string, string> = {}
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i]?.replace(/^--/, '')
      const v = rest[i + 1]
      if (k) args[k] = v
    }
    const orgName = args.orgName || args.name
    const email = args.email
    const password = args.password
    const rolesCsv = (args.roles ?? 'owner,admin').trim()
    if (!orgName || !email || !password) {
      console.error('Usage: mercato auth setup --orgName <name> --email <email> --password <password> [--roles owner,admin]')
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    // 1) Create tenant and organization
    const tenant = em.create(Tenant, { name: `${orgName} Tenant` })
    await em.persistAndFlush(tenant)
    const org = em.create(Organization, { name: orgName, tenant })
    await em.persistAndFlush(org)
    // 2) Ensure roles exist
    if (rolesCsv) {
      const roleNames = rolesCsv.split(',').map((s) => s.trim()).filter(Boolean)
      for (const name of roleNames) {
        let role = await em.findOne(Role, { name })
        if (!role) { role = em.create(Role, { name }); await em.persistAndFlush(role) }
      }
    }
    // 3) Create user in organization
    const user = em.create(User, { email, passwordHash: await hash(password, 10), isConfirmed: true, organization: org, tenant })
    await em.persistAndFlush(user)
    // 4) Assign roles if any
    if (rolesCsv) {
      const roleNames = rolesCsv.split(',').map((s) => s.trim()).filter(Boolean)
      for (const name of roleNames) {
        const role = await em.findOneOrFail(Role, { name })
        await em.persistAndFlush(em.create(UserRole, { user, role }))
      }
    }
    console.log('Setup complete:', { tenantId: tenant.id, organizationId: org.id, userId: user.id })
  },
}

// Export the full CLI list
export default [addUser, seedRoles, addOrganization, setupApp]
