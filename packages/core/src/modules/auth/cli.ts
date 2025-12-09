import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { ensureRoles, setupInitialTenant } from './lib/setup-app'
import { normalizeTenantId } from './lib/tenantAccess'
import { computeEmailHash } from './lib/emailHash'

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
    const orgTenantId = org.tenant?.id ? String(org.tenant.id) : null
    const normalizedTenantId = normalizeTenantId(orgTenantId ?? null) ?? null
    const u = em.create(User, {
      email,
      emailHash: computeEmailHash(email),
      passwordHash: await hash(password, 10),
      isConfirmed: true,
      organizationId: org.id,
      tenantId: org.tenant.id,
    })
    await em.persistAndFlush(u)
    if (rolesCsv) {
      const names = rolesCsv.split(',').map(s => s.trim()).filter(Boolean)
      for (const name of names) {
        let role = await em.findOne(Role, { name, tenantId: normalizedTenantId })
        if (!role && normalizedTenantId !== null) {
          role = await em.findOne(Role, { name, tenantId: null })
        }
        if (!role) {
        role = em.create(Role, { name, tenantId: normalizedTenantId, createdAt: new Date() })
          await em.persistAndFlush(role)
        } else if (normalizedTenantId !== null && role.tenantId !== normalizedTenantId) {
          role.tenantId = normalizedTenantId
          await em.persistAndFlush(role)
        }
        const link = em.create(UserRole, { user: u, role })
        await em.persistAndFlush(link)
      }
    }
    console.log('User created with id', u.id)
  },
}

const seedRoles: ModuleCli = {
  command: 'seed-roles',
  async run(rest) {
    const args: Record<string, string> = {}
    for (let i = 0; i < rest.length; i += 2) {
      const key = rest[i]?.replace(/^--/, '')
      if (!key) continue
      const value = rest[i + 1]
      if (value) args[key] = value
    }
    const tenantId = args.tenantId ?? args.tenant ?? args.tenant_id ?? null
    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    if (tenantId) {
      await ensureRoles(em, { tenantId })
      console.log('🛡️ Roles ensured for tenant', tenantId)
      return
    }
    const tenants = await em.find(Tenant, {})
    if (!tenants.length) {
      console.log('No tenants found; nothing to seed.')
      return
    }
    for (const tenant of tenants) {
      const id = tenant.id ? String(tenant.id) : null
      if (!id) continue
      await ensureRoles(em, { tenantId: id })
      console.log('🛡️ Roles ensured for tenant', id)
    }
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
    await rebuildHierarchyForTenant(em, String(tenant.id))
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
    const rolesCsv = (args.roles ?? 'superadmin,admin,employee').trim()
    if (!orgName || !email || !password) {
      console.error('Usage: mercato auth setup --orgName <name> --email <email> --password <password> [--roles superadmin,admin,employee]')
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    const roleNames = rolesCsv
      ? rolesCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined

    try {
      const result = await setupInitialTenant(em, {
        orgName,
        roleNames,
        primaryUser: { email, password, confirm: true },
        includeDerivedUsers: true,
      })

      if (result.reusedExistingUser) {
        console.log('⚠️  Existing initial user detected during setup.')
        console.log(`⚠️  Email: ${email}`)
        console.log('⚠️  Updated roles if missing and reused tenant/organization.')
      }

      for (const snapshot of result.users) {
        if (snapshot.created) {
          if (snapshot.user.email === email && password) {
            console.log('Created user', snapshot.user.email, 'password:', password)
          } else {
            console.log('Created user', snapshot.user.email)
          }
        } else {
          console.log(`Updated user ${snapshot.user.email}`)
        }
      }

      console.log('Setup complete:', { tenantId: result.tenantId, organizationId: result.organizationId })
    } catch (err) {
      if (err instanceof Error && err.message === 'USER_EXISTS') {
        console.error('Setup aborted: user already exists with the provided email.')
        return
      }
      throw err
    }
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

const setPassword: ModuleCli = {
  command: 'set-password',
  async run(rest) {
    const args: Record<string, string> = {}
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i]?.replace(/^--/, '')
      const v = rest[i + 1]
      if (k) args[k] = v
    }
    
    const email = args.email
    const password = args.password
    
    if (!email || !password) {
      console.error('Usage: mercato auth set-password --email <email> --password <newPassword>')
      return
    }
    
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const emailHash = computeEmailHash(email)
    const user = await em.findOne(User, { $or: [{ email }, { emailHash }] })
    
    if (!user) {
      console.error(`User with email "${email}" not found`)
      return
    }
    
    user.passwordHash = await hash(password, 10)
    await em.persistAndFlush(user)
    
    console.log(`✅ Password updated successfully for user: ${email}`)
  },
}

// Export the full CLI list
export default [addUser, seedRoles, addOrganization, setupApp, listOrganizations, listTenants, listUsers, setPassword]
