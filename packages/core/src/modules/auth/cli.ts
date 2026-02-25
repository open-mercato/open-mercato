import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { cliLogger } from '@open-mercato/cli/lib/helpers'

const logger = cliLogger.forModule('auth')
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { ensureRoles, setupInitialTenant } from './lib/setup-app'
import { normalizeTenantId } from './lib/tenantAccess'
import { computeEmailHash } from './lib/emailHash'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { env } from 'process'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import crypto from 'node:crypto'
import { formatPasswordRequirements, getPasswordPolicy, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { getCliModules } from '@open-mercato/shared/modules/registry'

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
      logger.error('Usage: mercato auth add-user --email <email> --password <password> --organizationId <id> [--roles customer,employee]')
      return
    }
    if (!ensurePasswordPolicy(password)) return
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const org =
      (await findOneWithDecryption(
        em,
        Organization,
        { id: organizationId },
        { populate: ['tenant'] },
        { tenantId: null, organizationId },
      )) ?? null
    if (!org) throw new Error('Organization not found')
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
    logger.info('User created with id', u.id)
  },
}

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

function normalizeKeyInput(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function hashSecret(value: string | null | undefined): string | null {
  if (!value) return null
  return crypto.createHash('sha256').update(normalizeKeyInput(value)).digest('hex').slice(0, 12)
}

function ensurePasswordPolicy(password: string): boolean {
  const policy = getPasswordPolicy()
  const result = validatePassword(password, policy)
  if (result.ok) return true
  const requirements = formatPasswordRequirements(policy, (_key, fallback) => fallback)
  const suffix = requirements ? `: ${requirements}` : ''
  logger.error(`Password does not meet the requirements${suffix}.`)
  return false
}

async function withEncryptionDebugDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.TENANT_DATA_ENCRYPTION_DEBUG
  process.env.TENANT_DATA_ENCRYPTION_DEBUG = 'no'
  try {
    return await fn()
  } finally {
    if (previous === undefined) {
      delete process.env.TENANT_DATA_ENCRYPTION_DEBUG
    } else {
      process.env.TENANT_DATA_ENCRYPTION_DEBUG = previous
    }
  }
}

class DerivedKeyKmsService implements KmsService {
  private root: Buffer
  constructor(secret: string) {
    this.root = crypto.createHash('sha256').update(normalizeKeyInput(secret)).digest()
  }

  isHealthy(): boolean {
    return true
  }

  private deriveKey(tenantId: string): string {
    const iterations = 310_000
    const keyLength = 32
    const derived = crypto.pbkdf2Sync(this.root, tenantId, iterations, keyLength, 'sha512')
    return derived.toString('base64')
  }

  async getTenantDek(tenantId: string): Promise<TenantDek | null> {
    if (!tenantId) return null
    return { tenantId, key: this.deriveKey(tenantId), fetchedAt: Date.now() }
  }

  async createTenantDek(tenantId: string): Promise<TenantDek | null> {
    return this.getTenantDek(tenantId)
  }
}

function fingerprintDek(dek: TenantDek | null): string | null {
  if (!dek?.key) return null
  return crypto.createHash('sha256').update(dek.key).digest('hex').slice(0, 12)
}

function decryptWithOldKey(
  payload: string,
  dek: TenantDek | null,
): string | null {
  if (!dek?.key) return null
  return decryptWithAesGcm(payload, dek.key)
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
      logger.info('🛡️ Roles ensured for tenant', tenantId)
      return
    }
    const tenants = await em.find(Tenant, {})
    if (!tenants.length) {
      logger.info('No tenants found; nothing to seed.')
      return
    }
    for (const tenant of tenants) {
      const id = tenant.id ? String(tenant.id) : null
      if (!id) continue
      await ensureRoles(em, { tenantId: id })
      logger.info('🛡️ Roles ensured for tenant', id)
    }
  },
}

const rotateEncryptionKey: ModuleCli = {
  command: 'rotate-encryption-key',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = (args.tenantId as string) ?? (args.tenant as string) ?? (args.tenant_id as string) ?? null
    const organizationId = (args.organizationId as string) ?? (args.orgId as string) ?? (args.org as string) ?? null
    const oldKey = (args['old-key'] as string) ?? (args.oldKey as string) ?? null
    const dryRun = Boolean(args['dry-run'] || args.dry)
    const debug = Boolean(args.debug)
    const rotate = Boolean(oldKey)
    if (rotate && !tenantId) {
      logger.warn(
        '⚠️  Rotating with --old-key across all tenants. A single old key should normally target one tenant; consider --tenant.',
      )
    }
    if (!isTenantDataEncryptionEnabled()) {
      logger.error('TENANT_DATA_ENCRYPTION is disabled; aborting.')
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    const encryptionService = new TenantDataEncryptionService(em as any, { kms: createKmsService() })
    const oldKms = rotate && oldKey ? new DerivedKeyKmsService(oldKey) : null
    if (debug) {
      logger.info('[rotate-encryption-key]', {
        hasOldKey: Boolean(oldKey),
        rotate,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
      })
      logger.info('[rotate-encryption-key] key fingerprints', {
        oldKey: hashSecret(oldKey),
        currentKey: hashSecret(process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY),
      })
    }
    if (!encryptionService.isEnabled()) {
      logger.error('Encryption service is not enabled (KMS unhealthy or no DEK). Aborting.')
      return
    }
    const conn: any = (em as any).getConnection?.()
    if (!conn || typeof conn.execute !== 'function') {
      logger.error('Unable to access raw connection; aborting.')
      return
    }
    const meta = (em as any)?.getMetadata?.()?.get?.(User)
    const tableName = meta?.tableName || 'users'
    const schema = meta?.schema
    const qualifiedTable = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`
    const isEncryptedPayload = (value: unknown): boolean => {
      if (typeof value !== 'string') return false
      const parts = value.split(':')
      return parts.length === 4 && parts[3] === 'v1'
    }
    const printedDek = new Set<string>()
    const oldDekCache = new Map<string, TenantDek | null>()
    const processScope = async (scopeTenantId: string, scopeOrganizationId: string): Promise<number> => {
      if (debug && !printedDek.has(scopeTenantId)) {
        printedDek.add(scopeTenantId)
        const [oldDek, newDek] = await Promise.all([
          oldKms?.getTenantDek(scopeTenantId) ?? Promise.resolve(null),
          encryptionService.getDek(scopeTenantId),
        ])
        logger.info('[rotate-encryption-key] dek fingerprints', {
          tenantId: scopeTenantId,
          oldKey: fingerprintDek(oldDek),
          currentKey: fingerprintDek(newDek),
        })
      }
      const rawRows = await conn.execute(
        `select id, email, email_hash from ${qualifiedTable} where tenant_id = ? and organization_id = ?`,
        [scopeTenantId, scopeOrganizationId],
      )
      const rows = Array.isArray(rawRows) ? rawRows : []
      const pending = rotate
        ? rows
        : rows.filter((row: any) => !isEncryptedPayload(row?.email))
      if (!pending.length) return 0
      logger.info(
        `Found ${pending.length} auth user records to process for org=${scopeOrganizationId}${dryRun ? ' (dry-run)' : ''}.`
      )
      if (dryRun) return 0
      const ids = pending.map((row: any) => String(row.id))
      const users = rotate
        ? await em.find(
            User,
            { id: { $in: ids }, tenantId: scopeTenantId, organizationId: scopeOrganizationId },
          )
        : await findWithDecryption(
            em,
            User,
            { id: { $in: ids }, tenantId: scopeTenantId, organizationId: scopeOrganizationId },
            {},
            { tenantId: scopeTenantId, organizationId: scopeOrganizationId, encryptionService },
          )
      const usersById = new Map(users.map((user) => [String(user.id), user]))
      let updated = 0
      for (const row of pending) {
        const user = usersById.get(String(row.id))
        if (!user) continue
        const rawEmail = typeof row.email === 'string' ? row.email : String(row.email ?? '')
        if (!rawEmail) continue
        if (rotate && (!isEncryptedPayload(rawEmail) || !oldKms)) {
          continue
        }
        let plainEmail = rawEmail
        if (rotate && isEncryptedPayload(rawEmail) && oldKms) {
          if (debug) {
            logger.info('[rotate-encryption-key] decrypting', {
              userId: row.id,
              tenantId: scopeTenantId,
              organizationId: scopeOrganizationId,
            })
          }
          let oldDek = oldDekCache.get(scopeTenantId) ?? null
          if (!oldDekCache.has(scopeTenantId)) {
            oldDek = await oldKms.getTenantDek(scopeTenantId)
            oldDekCache.set(scopeTenantId, oldDek)
          }
          const maybeEmail = decryptWithOldKey(rawEmail, oldDek)
          if (typeof maybeEmail !== 'string' || isEncryptedPayload(maybeEmail)) continue
          plainEmail = maybeEmail
        }
        if (!plainEmail) continue
        const encrypted = await encryptionService.encryptEntityPayload(
          'auth:user',
          { email: plainEmail },
          scopeTenantId,
          scopeOrganizationId,
        )
        const nextEmail = encrypted.email as string | undefined
        if (nextEmail && nextEmail !== user.email) {
          user.email = nextEmail as any
          user.emailHash = (encrypted as any).emailHash ?? computeEmailHash(plainEmail)
          em.persist(user)
          updated += 1
        }
      }
      if (updated > 0) {
        await em.flush()
      }
      return updated
    }

    if (tenantId && organizationId) {
      const updated = await processScope(String(tenantId), String(organizationId))
      if (!updated) {
        logger.info('All auth user emails already encrypted for the selected scope.')
      } else {
        logger.info(`Encrypted ${updated} auth user email(s).`)
      }
      return
    }

    const organizations = await em.find(Organization, {})
    if (!organizations.length) {
      logger.info('No organizations found; nothing to encrypt.')
      return
    }
    let total = 0
    for (const org of organizations) {
      const scopeTenantId = org.tenant?.id ? String(org.tenant.id) : org.tenant.id ? String(org.tenant.id) : null
      const scopeOrganizationId = org.id ? String(org.id) : null
      if (!scopeTenantId || !scopeOrganizationId) continue
      total += await processScope(scopeTenantId, scopeOrganizationId)
    }
    if (total > 0) {
      logger.info(`Encrypted ${total} auth user email(s) across all organizations.`)
    } else {
      logger.info('All auth user emails already encrypted across all organizations.')
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
      logger.error('Usage: mercato auth add-org --name <organization name>')
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
    logger.info('Organization created with id', org.id, 'in tenant', tenant.id)
  },
}

const setupApp: ModuleCli = {
  command: 'setup',
  async run(rest) {
    const args = parseArgs(rest)
    const orgName = typeof args.orgName === 'string'
      ? args.orgName
      : typeof args.name === 'string'
        ? args.name
        : undefined
    const email = typeof args.email === 'string' ? args.email : undefined
    const password = typeof args.password === 'string' ? args.password : undefined
    const rolesCsv = typeof args.roles === 'string'
      ? args.roles.trim()
      : 'superadmin,admin,employee'
    const skipPasswordPolicyRaw =
      args['skip-password-policy'] ??
      args.skipPasswordPolicy ??
      args['allow-weak-password'] ??
      args.allowWeakPassword
    const skipPasswordPolicy = typeof skipPasswordPolicyRaw === 'boolean'
      ? skipPasswordPolicyRaw
      : parseBooleanToken(typeof skipPasswordPolicyRaw === 'string' ? skipPasswordPolicyRaw : null) ?? false
    if (!orgName || !email || !password) {
      logger.error('Usage: mercato auth setup --orgName <name> --email <email> --password <password> [--roles superadmin,admin,employee] [--skip-password-policy]')
      return
    }
    if (!skipPasswordPolicy && !ensurePasswordPolicy(password)) return
    if (skipPasswordPolicy) {
      logger.warn('⚠️  Password policy validation skipped for setup.')
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
        modules: getCliModules(),
      })

      if (result.reusedExistingUser) {
        logger.info('⚠️  Existing initial user detected during setup.')
        logger.info(`⚠️  Email: ${email}`)
        logger.info('⚠️  Updated roles if missing and reused tenant/organization.')
      }

      if(env.NODE_ENV !== 'test') { 
        for (const snapshot of result.users) {
          if (snapshot.created) {
            if (snapshot.user.email === email && password) {
              logger.info('🎉 Created user', snapshot.user.email, 'password:', password)
            } else {
              logger.info('🎉 Created user', snapshot.user.email)
            }
          } else {
            logger.info(`Updated user ${snapshot.user.email}`)
          }
        }
      }

      if(env.NODE_ENV !== 'test')   logger.info('✅ Setup complete:', { tenantId: result.tenantId, organizationId: result.organizationId })
    } catch (err) {
      if (err instanceof Error && err.message === 'USER_EXISTS') {
        logger.error('Setup aborted: user already exists with the provided email.')
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
    const orgs = await findWithDecryption(
      em,
      Organization,
      {},
      { populate: ['tenant'] },
      { tenantId: null, organizationId: null },
    )
    
    if (orgs.length === 0) {
      logger.info('No organizations found')
      return
    }
    
    logger.info(`Found ${orgs.length} organization(s):`)
    logger.info('')
    logger.info('ID                                   | Name                    | Tenant ID                            | Created')
    logger.info('-------------------------------------|-------------------------|-------------------------------------|-------------------')
    
    for (const org of orgs) {
      const created = org.createdAt ? new Date(org.createdAt).toLocaleDateString() : 'N/A'
      const id = org.id || 'N/A'
      const tenantId = org.tenant?.id || 'N/A'
      const name = (org.name || 'Unnamed').padEnd(23)
      logger.info(`${id.padEnd(35)} | ${name} | ${tenantId.padEnd(35)} | ${created}`)
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
      logger.info('No tenants found')
      return
    }
    
    logger.info(`Found ${tenants.length} tenant(s):`)
    logger.info('')
    logger.info('ID                                   | Name                    | Created')
    logger.info('-------------------------------------|-------------------------|-------------------')
    
    for (const tenant of tenants) {
      const created = tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : 'N/A'
      const id = tenant.id || 'N/A'
      const name = (tenant.name || 'Unnamed').padEnd(23)
      logger.info(`${id.padEnd(35)} | ${name} | ${created}`)
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
      logger.info('No users found')
      return
    }
    
    logger.info(`Found ${users.length} user(s):`)
    logger.info('')
    logger.info('ID                                   | Email                   | Name                    | Organization ID      | Tenant ID            | Roles')
    logger.info('-------------------------------------|-------------------------|-------------------------|---------------------|---------------------|-------------------')
    
    for (const user of users) {
      // Get user roles separately
      const userRoles = await findWithDecryption(
        em,
        UserRole,
        { user: user.id },
        { populate: ['role'] },
        { tenantId: user.tenantId ?? null, organizationId: user.organizationId ?? null },
      )
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
      
      logger.info(`${id.padEnd(35)} | ${email} | ${name} | ${orgName.padEnd(19)} | ${tenantName.padEnd(19)} | ${roles}`)
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
      logger.error('Usage: mercato auth set-password --email <email> --password <newPassword>')
      return
    }
    if (!ensurePasswordPolicy(password)) return
    
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const emailHash = computeEmailHash(email)
    const user = await em.findOne(User, { $or: [{ email }, { emailHash }] })
    
    if (!user) {
      logger.error(`User with email "${email}" not found`)
      return
    }
    
    user.passwordHash = await hash(password, 10)
    await em.persistAndFlush(user)
    
    logger.info(`✅ Password updated successfully for user: ${email}`)
  },
}

// Export the full CLI list
export default [addUser, seedRoles, rotateEncryptionKey, addOrganization, setupApp, listOrganizations, listTenants, listUsers, setPassword]
