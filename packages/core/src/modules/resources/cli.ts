import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedResourcesActivityTypes, seedResourcesAddressTypes, seedResourcesCapacityUnits, seedResourcesResourceExamples, type ResourcesSeedScope } from './lib/seeds'
import { isDictionariesModuleEnabled } from './lib/optionalModules'

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

const seedCapacityUnitsCommand: ModuleCli = {
  command: 'seed-capacity-units',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-capacity-units --tenant <tenantId> --org <organizationId>')
      return
    }
    if (!isDictionariesModuleEnabled()) {
      console.log('Dictionaries module is disabled; skipping resources capacity units.')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesCapacityUnits(tem, scope)
      })
      console.log('📏 Resources capacity units seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedActivityTypesCommand: ModuleCli = {
  command: 'seed-activity-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-activity-types --tenant <tenantId> --org <organizationId>')
      return
    }
    if (!isDictionariesModuleEnabled()) {
      console.log('Dictionaries module is disabled; skipping resources activity types.')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesActivityTypes(tem, scope)
      })
      console.log('🗂️  Resources activity types seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedAddressTypesCommand: ModuleCli = {
  command: 'seed-address-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-address-types --tenant <tenantId> --org <organizationId>')
      return
    }
    if (!isDictionariesModuleEnabled()) {
      console.log('Dictionaries module is disabled; skipping resources address types.')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesAddressTypes(tem, scope)
      })
      console.log('🏠 Resources address types seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedExamplesCommand: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    if (!isDictionariesModuleEnabled()) {
      console.log('Dictionaries module is disabled; skipping resources activity types.')
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesResourceExamples(tem, scope)
      })
      console.log('🧩 Resources example resources seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedCapacityUnitsCommand, seedActivityTypesCommand, seedAddressTypesCommand, seedExamplesCommand]
