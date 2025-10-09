import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { hash } from 'bcryptjs'
import { User, Role, UserRole, RoleAcl, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'

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
    const defaults = ['employee', 'admin', 'superadmin']
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    await em.transactional(async (tem: any) => {
      for (const name of defaults) {
        const existing = await tem.findOne(Role, { name })
        if (!existing) {
          tem.persist(tem.create(Role, { name }))
          console.log('Inserted role', name)
        }
      }
      await tem.flush()
    })
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
    const em = resolve('em') as any

    // Helper: simple warning output (emoji only)
    function warnBox(lines: string[]) {
      for (const line of lines) console.log(`⚠️  ${line}`)
    }

    // Normalize roles once
    const roleNames = rolesCsv
      ? rolesCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : []

    // Ensure roles exist upfront (idempotent)
    await em.transactional(async (tem: any) => {
      for (const name of roleNames) {
        let role = await tem.findOne(Role, { name })
        if (!role) { role = tem.create(Role, { name }); tem.persist(role) }
      }
      await tem.flush()
    })

    // If user already exists, reuse existing org/tenant and ensure roles
    const existingUser = await em.findOne(User, { email })
    if (existingUser) {
      await em.transactional(async (tem: any) => {
        if (roleNames.length) {
          const currentUserRoles = await tem.find(UserRole, { user: existingUser.id }, { populate: ['role'] })
          const currentRoleNames = new Set(currentUserRoles.map((ur: any) => ur.role?.name).filter(Boolean) as string[])
          for (const name of roleNames) {
            if (!currentRoleNames.has(name)) {
              const role = await tem.findOneOrFail(Role, { name })
              tem.persist(tem.create(UserRole, { user: existingUser, role }))
            }
          }
        }
        await tem.flush()
      })
      warnBox([
        'Existing initial user detected during setup.',
        `Email: ${existingUser.email}`,
        'Updated roles if missing and reused tenant/organization.',
        'No new user created.',
      ])
      console.log('Setup complete:', { tenantId: existingUser.tenantId, organizationId: existingUser.organizationId, userId: existingUser.id })
      return
    }

    let seedTenantId: string | undefined
    let seedOrgId: string | undefined
    await em.transactional(async (tem: any) => {
      // 1) Create tenant and organization
      const tenant = tem.create(Tenant, { name: `${orgName} Tenant` })
      tem.persist(tenant)
      await tem.flush()
      const org = tem.create(Organization, { name: orgName, tenant })
      tem.persist(org)
      await tem.flush()
      seedTenantId = (tenant as any).id
      seedOrgId = (org as any).id

      // 2) Create or update users (superadmin + optionally admin/employee) idempotently
      // Derivation rule: if the provided email local part is exactly 'superadmin',
      // derive admin and employee emails by replacing it. Otherwise, only create the provided superadmin.
      const [local, domain] = String(email).split('@')
      const isSuperadminLocal = (local || '').toLowerCase() === 'superadmin'
      const adminEmailDerived = isSuperadminLocal && domain ? `admin@${domain}` : null
      const employeeEmailDerived = isSuperadminLocal && domain ? `employee@${domain}` : null

      const users: Array<{ email: string; password: string; roles: string[] }> = [
        { email, password, roles: ['superadmin'] },
      ]
      if (adminEmailDerived) users.push({ email: adminEmailDerived, password, roles: ['admin'] })
      if (employeeEmailDerived) users.push({ email: employeeEmailDerived, password, roles: ['employee'] })
      for (const udef of users) {
        let u = await tem.findOne(User, { email: udef.email })
        if (u) {
          u.passwordHash = await hash(udef.password, 10)
          u.isConfirmed = true
          u.organizationId = org.id
          u.tenantId = tenant.id
          tem.persist(u)
          console.log('Updated user', udef.email)
          warnBox([
            'Existing user updated (idempotent setup).',
            `Email: ${udef.email}`,
            'Password reset and organization/tenant synchronized with current setup.',
          ])
        } else {
          u = tem.create(User, { email: udef.email, passwordHash: await hash(udef.password, 10), isConfirmed: true, organizationId: org.id, tenantId: tenant.id })
          tem.persist(u)
          console.log('Created user', udef.email, 'password:', password)
        }
        await tem.flush()
        // Ensure role links exist (idempotent)
        for (const name of udef.roles) {
          const role = await tem.findOneOrFail(Role, { name })
          const existingLink = await tem.findOne(UserRole, { user: u as any, role: role as any } as any)
          if (!existingLink) {
            tem.persist(tem.create(UserRole, { user: u as any, role: role as any }))
          }
        }
        await tem.flush()
      }

      // Transaction complete; tenant/org ids captured above
    })

    if (seedTenantId) {
      await rebuildHierarchyForTenant(em, seedTenantId)
    }

    // 3) Seed role ACLs outside transaction: superadmin -> isSuperAdmin; admin -> all features; employee -> example module
    const superadminRole = await em.findOne(Role, { name: 'superadmin' })
    const adminRole = await em.findOne(Role, { name: 'admin' })
    const employeeRole = await em.findOne(Role, { name: 'employee' })
    if (superadminRole) {
      await em.persistAndFlush(em.create(RoleAcl, {
        role: superadminRole,
        tenantId: seedTenantId,
        isSuperAdmin: true,
        featuresJson: ['directory.tenants.*'],
      }))
    }
    if (adminRole) {
      const adminFeatures = [
        'auth.*',
        'entities.*',
        'attachments.*',
        'query_index.*',
        'directory.organizations.*',
        'example.*',
      ]
      await em.persistAndFlush(em.create(RoleAcl, { role: adminRole, tenantId: seedTenantId, featuresJson: adminFeatures }))
    }
    if (employeeRole) await em.persistAndFlush(em.create(RoleAcl, { role: employeeRole, tenantId: seedTenantId, featuresJson: ['example.*'] }))

    console.log('Setup complete:', { tenantId: seedTenantId, organizationId: seedOrgId })
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
    
    const user = await em.findOne(User, { email })
    
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
