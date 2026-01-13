import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedContractorRoleTypes, type ContractorSeedScope } from './lib/seeds'

function parseArgs(rest: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part) continue
    if (part.startsWith('--')) {
      const [rawKey, rawValue] = part.slice(2).split('=')
      if (rawValue !== undefined) args[rawKey] = rawValue
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
        args[rawKey] = rest[i + 1]!
        i += 1
      }
    }
  }
  return args
}

const seedRoleTypesCommand: ModuleCli = {
  command: 'seed-role-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato contractors seed-role-types --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ContractorSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      const result = await em.transactional(async (tem) => {
        return seedContractorRoleTypes(tem, scope)
      })
      console.log(`Contractor role types seeded for organization ${organizationId}:`)
      console.log(`  Created: ${result.created}`)
      console.log(`  Skipped (already exist): ${result.skipped}`)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedRoleTypesCommand]
