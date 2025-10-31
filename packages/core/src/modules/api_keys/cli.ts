import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { createApiKey } from './services/apiKeyService'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { Role } from '@open-mercato/core/modules/auth/data/entities'

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '')
    const value = rest[i + 1]
    if (key) args[key] = value ?? ''
  }
  return args
}

const addApiKey: ModuleCli = {
  command: 'add',
  async run(rest) {
    const args = parseArgs(rest)
    const name = args.name || args.label
    const organizationId = args.organizationId || args.orgId || args.org
    let tenantId: string | null = args.tenantId || args.tenant || null
    const rolesCsv = args.roles || ''

    if (!name) {
      console.error('Usage: mercato api_keys add --name <name> [--organizationId <uuid>] [--tenantId <uuid>] [--roles roleA,roleB]')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as any

    let orgRecord: any = null
    if (organizationId) {
      orgRecord = await em.findOne(Organization, { id: organizationId })
      if (!orgRecord) {
        console.error('Organization not found:', organizationId)
        return
      }
      tenantId = tenantId ?? (orgRecord.tenant ? String(orgRecord.tenant.id) : null)
    }

    if (!tenantId) {
      console.error('Tenant context is required. Provide --tenantId or select an organization belonging to a tenant.')
      return
    }

    const roleInputs = rolesCsv
      ? rolesCsv.split(',').map((value) => value.trim()).filter(Boolean)
      : []
    const roleIds: string[] = []
    if (roleInputs.length) {
      for (const token of roleInputs) {
        let role = await em.findOne(Role, { id: token })
        if (!role) {
          role = await em.findOne(Role, { name: token })
        }
        if (!role) {
          console.error(`Role not found: ${token}`)
          return
        }
        roleIds.push(String(role.id))
      }
    }

    const { record, secret } = await createApiKey(em, {
      name,
      description: args.description || null,
      organizationId: organizationId || null,
      tenantId,
      roles: roleIds,
      createdBy: null,
      expiresAt: args.expiresAt ? new Date(args.expiresAt) : null,
    }, { rbac })

    console.log('API key created:')
    console.log('  id:', record.id)
    console.log('  name:', record.name)
    console.log('  tenantId:', record.tenantId)
    console.log('  organizationId:', record.organizationId ?? 'null')
    if (roleIds.length) console.log('  roles:', roleInputs.join(', '))
    console.log('  keyPrefix:', record.keyPrefix)
    console.log('')
    console.log('Secret (store immediately):')
    console.log(secret)
  },
}

export default [addApiKey]
