import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { hash } from 'bcryptjs'
import { User, Role, UserRole, RoleAcl, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
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
    const org = await em.findOneOrFail(Organization, { id: organizationId }, { populate: ['tenant'] })
    const u = em.create(User, { email, passwordHash: await hash(password, 10), isConfirmed: true, organizationId: org.id, tenantId: org.tenant.id })
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
    const defaults = ['employee', 'admin', 'owner', 'superadmin']
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
    const rolesCsv = (args.roles ?? 'superadmin,owner,admin,employee').trim()
    if (!orgName || !email || !password) {
      console.error('Usage: mercato auth setup --orgName <name> --email <email> --password <password> [--roles owner,admin]')
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    // Normalize roles once
    const roleNames = rolesCsv
      ? rolesCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : []

    // Ensure roles exist upfront (idempotent)
    for (const name of roleNames) {
      let role = await em.findOne(Role, { name })
      if (!role) { role = em.create(Role, { name }); await em.persistAndFlush(role) }
    }

    // If user already exists, reuse existing org/tenant and ensure roles
    const existingUser = await em.findOne(User, { email })
    if (existingUser) {
      // Assign any missing roles
      if (roleNames.length) {
        const currentUserRoles = await em.find(UserRole, { user: existingUser.id }, { populate: ['role'] })
        const currentRoleNames = new Set(currentUserRoles.map((ur: any) => ur.role?.name).filter(Boolean) as string[])
        for (const name of roleNames) {
          if (!currentRoleNames.has(name)) {
            const role = await em.findOneOrFail(Role, { name })
            await em.persistAndFlush(em.create(UserRole, { user: existingUser, role }))
          }
        }
      }
      console.log('Setup complete:', { tenantId: existingUser.tenantId, organizationId: existingUser.organizationId, userId: existingUser.id })
      return
    }

    // 1) Create tenant and organization
    const tenant = em.create(Tenant, { name: `${orgName} Tenant` })
    await em.persistAndFlush(tenant)
    const org = em.create(Organization, { name: orgName, tenant })
    await em.persistAndFlush(org)

    // 2) Create users (superadmin, admin, employee)
    const users: Array<{ email: string; password: string; roles: string[] }> = [
      { email, password, roles: ['superadmin'] },
      { email: 'admin@' + (orgName || 'acme').toLowerCase() + '.com', password, roles: ['admin'] },
      { email: 'employee@' + (orgName || 'acme').toLowerCase() + '.com', password, roles: ['employee'] },
    ]
    for (const udef of users) {
      const u = em.create(User, { email: udef.email, passwordHash: await hash(udef.password, 10), isConfirmed: true, organizationId: org.id, tenantId: tenant.id })
      await em.persistAndFlush(u)
      for (const name of udef.roles) {
        const role = await em.findOneOrFail(Role, { name })
        await em.persistAndFlush(em.create(UserRole, { user: u, role }))
      }
      console.log('Created user', udef.email, 'password:', password)
    }

    // 3) Seed role ACLs: owner -> superadmin; admin -> all features; employee -> example module
    const ownerRole = await em.findOne(Role, { name: 'owner' })
    const adminRole = await em.findOne(Role, { name: 'admin' })
    const employeeRole = await em.findOne(Role, { name: 'employee' })
    if (ownerRole) await em.persistAndFlush(em.create(RoleAcl, { role: ownerRole, tenantId: tenant.id, isSuperAdmin: true }))
    if (adminRole) await em.persistAndFlush(em.create(RoleAcl, { role: adminRole, tenantId: tenant.id, featuresJson: ['*'] }))
    if (employeeRole) await em.persistAndFlush(em.create(RoleAcl, { role: employeeRole, tenantId: tenant.id, featuresJson: ['example.*'] }))

    console.log('Setup complete:', { tenantId: tenant.id, organizationId: org.id })
  },
}

const listOrganizations: ModuleCli = {
  command: 'list-orgs',
  async run() {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const orgs = await em.find(Organization, {}, { populate: ['tenant'] })
    
    if (orgs.length === 0) {
      console.log('No organizations found')
      return
    }
    
    console.log(`Found ${orgs.length} organization(s):`)
    console.log('')
    console.log('ID                                   | Name                    | Tenant ID                            | Created')
    console.log('-------------------------------------|-------------------------|-------------------------------------|-------------------')
    
    for (const org of orgs) {
      const created = org.createdAt ? new Date(org.createdAt).toLocaleDateString() : 'N/A'
      const id = org.id || 'N/A'
      const tenantId = org.tenant?.id || 'N/A'
      const name = (org.name || 'Unnamed').padEnd(23)
      console.log(`${id.padEnd(35)} | ${name} | ${tenantId.padEnd(35)} | ${created}`)
    }
  },
}

const listTenants: ModuleCli = {
  command: 'list-tenants',
  async run() {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const tenants = await em.find(Tenant, {})
    
    if (tenants.length === 0) {
      console.log('No tenants found')
      return
    }
    
    console.log(`Found ${tenants.length} tenant(s):`)
    console.log('')
    console.log('ID                                   | Name                    | Created')
    console.log('-------------------------------------|-------------------------|-------------------')
    
    for (const tenant of tenants) {
      const created = tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : 'N/A'
      const id = tenant.id || 'N/A'
      const name = (tenant.name || 'Unnamed').padEnd(23)
      console.log(`${id.padEnd(35)} | ${name} | ${created}`)
    }
  },
}

const listUsers: ModuleCli = {
  command: 'list-users',
  async run(rest) {
    const args: Record<string, string> = {}
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i]?.replace(/^--/, '')
      const v = rest[i + 1]
      if (k) args[k] = v
    }
    
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    
    // Build query with optional filters
    const where: any = {}
    if (args.organizationId || args.orgId || args.org) {
      where.organizationId = args.organizationId || args.orgId || args.org
    }
    if (args.tenantId || args.tenant) {
      where.tenantId = args.tenantId || args.tenant
    }
    
    const users = await em.find(User, where)
    
    if (users.length === 0) {
      console.log('No users found')
      return
    }
    
    console.log(`Found ${users.length} user(s):`)
    console.log('')
    console.log('ID                                   | Email                   | Name                    | Organization ID      | Tenant ID            | Roles')
    console.log('-------------------------------------|-------------------------|-------------------------|---------------------|---------------------|-------------------')
    
    for (const user of users) {
      // Get user roles separately
      const userRoles = await em.find(UserRole, { user: user.id }, { populate: ['role'] })
      const roles = userRoles.map((ur: any) => ur.role?.name).filter(Boolean).join(', ') || 'None'
      
      // Get organization and tenant names if IDs exist
      let orgName = 'N/A'
      let tenantName = 'N/A'
      
      if (user.organizationId) {
        const org = await em.findOne(Organization, { id: user.organizationId })
        orgName = org?.name?.substring(0, 19) + '...' || user.organizationId.substring(0, 8) + '...'
      }
      
      if (user.tenantId) {
        const tenant = await em.findOne(Tenant, { id: user.tenantId })
        tenantName = tenant?.name?.substring(0, 19) + '...' || user.tenantId.substring(0, 8) + '...'
      }
      
      const id = user.id || 'N/A'
      const email = (user.email || 'N/A').padEnd(23)
      const name = (user.name || 'Unnamed').padEnd(23)
      
      console.log(`${id.padEnd(35)} | ${email} | ${name} | ${orgName.padEnd(19)} | ${tenantName.padEnd(19)} | ${roles}`)
    }
  },
}

// Export the full CLI list
export default [addUser, seedRoles, addOrganization, setupApp, listOrganizations, listTenants, listUsers]
